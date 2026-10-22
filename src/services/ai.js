const { saveAiDecision } = require("./db");
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { ChatOllama } = require("@langchain/ollama");
const { PromptTemplate } = require("@langchain/core/prompts");
const { StructuredOutputParser } = require("@langchain/core/output_parsers");
const { z } = require("zod");
const { logAiDecision } = require('../utils/logger');
const {
    aiInferenceLatencyHistogram,
    iltDetectionCounter,
    iltDurationSecondsCounter,
    aiDecisionsCounter,
    aiQueueDepthGauge
} = require('../utils/metrics');

const telemetryEvents = new EventEmitter();

const DEFAULT_SOP_CONFIG = Object.freeze({
    min_wob: 5,
    min_rpm: 20,
    min_flow: 100,
    max_conn_time: 180
});

const configPath = path.join(__dirname, '../sop-config.json');

let inMemorySopConfig = { ...DEFAULT_SOP_CONFIG };

function getSopConfig() {
    try {
        if (fs.existsSync(configPath)) {
            const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            inMemorySopConfig = { ...DEFAULT_SOP_CONFIG, ...parsed };
        }
    } catch (error) {
        console.warn('[SOP Config] Falling back to in-memory SOP defaults:', error.message);
    }
    return { ...inMemorySopConfig };
}

function updateSopConfig(nextConfig) {
    inMemorySopConfig = {
        min_wob: Number(nextConfig?.min_wob ?? inMemorySopConfig.min_wob),
        min_rpm: Number(nextConfig?.min_rpm ?? inMemorySopConfig.min_rpm),
        min_flow: Number(nextConfig?.min_flow ?? inMemorySopConfig.min_flow),
        max_conn_time: Number(nextConfig?.max_conn_time ?? inMemorySopConfig.max_conn_time)
    };
    try {
        fs.writeFileSync(configPath, JSON.stringify(inMemorySopConfig, null, 2));
    } catch (error) {
        console.warn('[SOP Config] Persisting to disk failed; retaining in-memory config:', error.message);
    }
    return { ...inMemorySopConfig };
}

/**
 * Deterministically evaluates sensor window averages and durations against active SOP rules
 * so small edge models (qwen2.5:1.5b) cannot hallucinate ILT false positives or inverted inequalities.
 */
function evaluateSopDeterministic(data, sopConfig) {
    const points = data.telemetry || [];
    const count = Math.max(points.length, 1);
    const avgWob = Number((points.reduce((s, p) => s + Number(p.wob_klbs || 0), 0) / count).toFixed(2));
    const avgRpm = Number((points.reduce((s, p) => s + Number(p.rpm || 0), 0) / count).toFixed(2));
    const avgFlow = Number((points.reduce((s, p) => s + Number(p.flow_in_gpm || 0), 0) / count).toFixed(2));

    const declaredOp = String(data.metadata?.active_operation || 'unknown').toLowerCase();
    const startMs = Date.parse(data.metadata?.window_start);
    const endMs = Date.parse(data.metadata?.window_end);
    const windowSpanSec = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
        ? Math.round((endMs - startMs) / 1000)
        : count * (Number(data.metadata?.interval_seconds) || 10);

    if (declaredOp === 'drilling') {
        const wobOk = avgWob >= sopConfig.min_wob;
        const rpmOk = avgRpm >= sopConfig.min_rpm;
        const flowOk = avgFlow >= sopConfig.min_flow;
        const isIlt = !(wobOk && rpmOk && flowOk);
        const wobCmp = wobOk ? '>' : '<';
        const rpmCmp = rpmOk ? '>' : '<';
        const flowCmp = flowOk ? '>' : '<';
        const factualJustification =
            `Actual WOB ${avgWob} is ${wobCmp} min ${sopConfig.min_wob} required, ` +
            `RPM ${avgRpm} is ${rpmCmp} min ${sopConfig.min_rpm} required, ` +
            `Flow ${avgFlow} is ${flowCmp} min ${sopConfig.min_flow} required.`;

        return {
            declared_op: declaredOp,
            actual_state: isIlt ? 'drilling_dysfunction' : 'drilling',
            is_ilt: isIlt,
            ilt_duration_seconds: isIlt ? Math.min(windowSpanSec, sopConfig.max_conn_time) : 0,
            avg_wob: avgWob,
            avg_rpm: avgRpm,
            avg_flow: avgFlow,
            summary: factualJustification,
            factual_justification: factualJustification
        };
    }

    if (declaredOp === 'connection') {
        const pumpsOff = avgWob === 0 && avgRpm === 0 && avgFlow === 0;
        const overMaxConn = windowSpanSec > sopConfig.max_conn_time || (pumpsOff && points.length >= 3);
        const iltSec = overMaxConn
            ? (windowSpanSec > sopConfig.max_conn_time ? windowSpanSec - sopConfig.max_conn_time : sopConfig.max_conn_time)
            : 0;
        const connCmp = overMaxConn ? '>' : '<=';
        const factualJustification =
            `Connection duration ${windowSpanSec}s is ${connCmp} max ${sopConfig.max_conn_time}s allowed ` +
            `(Actual WOB ${avgWob}, RPM ${avgRpm}, Flow ${avgFlow}).`;

        return {
            declared_op: declaredOp,
            actual_state: 'connection',
            is_ilt: overMaxConn,
            ilt_duration_seconds: iltSec,
            avg_wob: avgWob,
            avg_rpm: avgRpm,
            avg_flow: avgFlow,
            summary: factualJustification,
            factual_justification: factualJustification
        };
    }

    const factualJustification = `Operation ${declaredOp}: Actual WOB ${avgWob}, RPM ${avgRpm}, Flow ${avgFlow}.`;
    return {
        declared_op: declaredOp,
        actual_state: declaredOp,
        is_ilt: false,
        ilt_duration_seconds: 0,
        avg_wob: avgWob,
        avg_rpm: avgRpm,
        avg_flow: avgFlow,
        summary: factualJustification,
        factual_justification: factualJustification
    };
}

/**
 * Ensures the LLM justification does not invert '<' and '>' inequalities against the factual check.
 */
function sanitizeJustification(rawJustification, preCheck) {
    const text = String(rawJustification || '').trim();
    if (!text) return preCheck.factual_justification;

    if (preCheck.declared_op === 'drilling' && !preCheck.is_ilt) {
        if (text.includes('<') || /less than|below/i.test(text)) {
            return preCheck.factual_justification;
        }
    }
    if (preCheck.declared_op === 'drilling' && preCheck.is_ilt) {
        if (!text.includes('<') && !/less than|below/i.test(text)) {
            return preCheck.factual_justification;
        }
    }
    if (preCheck.declared_op === 'connection' && preCheck.is_ilt) {
        if (text.includes('>') && !text.includes('max') && !text.includes('<')) {
            return preCheck.factual_justification;
        }
    }
    return text;
}

const outputParser = StructuredOutputParser.fromZodSchema(
    z.object({
        actual_state: z.string(),
        is_ilt: z.boolean(),
        ilt_duration_seconds: z.number(),
        confidence_score: z.number(),
        justification: z.string().describe("Strict engineering logic. State the exact numeric comparisons factually without hallucinating (e.g., 'Actual WOB 18 is > min 5 required').")
    })
);

// Bounded FIFO Inference Queue (concurrency = 1) to protect edge CPU
const inferenceQueue = [];
let isProcessingQueue = false;

function updateQueueMetric() {
    aiQueueDepthGauge.set(inferenceQueue.length + (isProcessingQueue ? 1 : 0));
}

function getQueueStatus() {
    return {
        queued: inferenceQueue.length,
        processing: isProcessingQueue,
        total_pending: inferenceQueue.length + (isProcessingQueue ? 1 : 0)
    };
}

async function processSingleBatch(data) {
    const modelName = process.env.OLLAMA_MODEL_NAME || "qwen2.5:1.5b";
    const endTimer = aiInferenceLatencyHistogram.startTimer({ model: modelName });
    const sopConfig = getSopConfig();
    const preCheck = evaluateSopDeterministic(data, sopConfig);
    try {
        const model = new ChatOllama({
            baseUrl: process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || "http://localhost:11434",
            model: modelName,
            temperature: 0,
            format: "json"
        });

        const prompt = new PromptTemplate({
            template: `Analyze this WITSML telemetry against the Operating Rules.
### Rules:
1. Drilling: WOB > {min_wob}, RPM > {min_rpm}, Flow > {min_flow}. If ALL three are met, is_ilt MUST be false and ilt_duration_seconds MUST be 0.
2. Connection: Max {max_conn_time}s.

### Pre-Computed Engineering Check:
{pre_check_summary} -> Expected is_ilt={expected_is_ilt}, Expected ilt_duration_seconds={expected_ilt_seconds}

### Payload:
Declared: {declared_op}
Telemetry: {telemetry_data}

### Output:
{format_instructions}
Output raw JSON. Your 'justification' field MUST copy the exact inequalities from the Pre-Computed Engineering Check without flipping '>' or '<'.`,
            inputVariables: [
                "declared_op",
                "telemetry_data",
                "min_wob",
                "min_rpm",
                "min_flow",
                "max_conn_time",
                "pre_check_summary",
                "expected_is_ilt",
                "expected_ilt_seconds"
            ],
            partialVariables: { format_instructions: outputParser.getFormatInstructions() }
        });

        const chain = prompt.pipe(model).pipe(outputParser);
        const rawResult = await chain.invoke({
            declared_op: data.metadata.active_operation,
            telemetry_data: JSON.stringify(data.telemetry),
            min_wob: sopConfig.min_wob,
            min_rpm: sopConfig.min_rpm,
            min_flow: sopConfig.min_flow,
            max_conn_time: sopConfig.max_conn_time,
            pre_check_summary: preCheck.summary,
            expected_is_ilt: String(preCheck.is_ilt),
            expected_ilt_seconds: String(preCheck.ilt_duration_seconds)
        });

        endTimer({ status: 'success' });

        // Guard against 1.5B model boolean/duration/symbol hallucinations using deterministic SOP evaluation
        const rawConfidence = Number(rawResult.confidence_score);
        const normalizedConfidence = Number.isFinite(rawConfidence)
            ? (rawConfidence > 1 ? Number((rawConfidence / 100).toFixed(2)) : Number(rawConfidence.toFixed(2)))
            : 0.95;

        const rig_id = data.metadata.rig_id;
        const well_id = data.metadata.well_id;
        const actual_state = preCheck.actual_state || rawResult.actual_state || 'unknown';
        const is_ilt = preCheck.is_ilt;
        const ilt_duration_seconds = is_ilt ? preCheck.ilt_duration_seconds : 0;
        const justification = sanitizeJustification(rawResult.justification, preCheck);

        aiDecisionsCounter.inc({
            rig_id,
            well_id,
            actual_state,
            is_ilt: String(Boolean(is_ilt))
        });

        if (is_ilt) {
            iltDetectionCounter.inc({ rig_id, well_id, actual_state });
            if (ilt_duration_seconds > 0) {
                iltDurationSecondsCounter.inc({ rig_id, well_id, actual_state }, ilt_duration_seconds);
            }
        }

        const enrichedResult = {
            actual_state,
            is_ilt,
            ilt_duration_seconds,
            confidence_score: normalizedConfidence,
            justification,
            rig_id,
            well_id,
            declared_op: data.metadata.active_operation,
            timestamp: new Date().toISOString()
        };

        telemetryEvents.emit('assessment', enrichedResult);
        logAiDecision(data.metadata, "local-compute-0-cost", enrichedResult);
        await saveAiDecision(enrichedResult, data.metadata);
        return enrichedResult;
    } catch (error) {
        endTimer({ status: 'error' });
        console.error("[Agent Error] AI Processing Failed, applying deterministic SOP failover:", error.message);

        const rig_id = data.metadata.rig_id;
        const well_id = data.metadata.well_id;
        const actual_state = preCheck.actual_state || 'unknown';
        const is_ilt = preCheck.is_ilt;
        const ilt_duration_seconds = is_ilt ? preCheck.ilt_duration_seconds : 0;

        aiDecisionsCounter.inc({
            rig_id,
            well_id,
            actual_state,
            is_ilt: String(Boolean(is_ilt))
        });

        if (is_ilt) {
            iltDetectionCounter.inc({ rig_id, well_id, actual_state });
            if (ilt_duration_seconds > 0) {
                iltDurationSecondsCounter.inc({ rig_id, well_id, actual_state }, ilt_duration_seconds);
            }
        }

        const fallbackResult = {
            actual_state,
            is_ilt,
            ilt_duration_seconds,
            confidence_score: 1.0,
            justification: `[Deterministic SOP Failover] ${preCheck.factual_justification}`,
            rig_id,
            well_id,
            declared_op: data.metadata.active_operation,
            fallback: true,
            timestamp: new Date().toISOString()
        };

        telemetryEvents.emit('assessment', fallbackResult);
        logAiDecision(data.metadata, "deterministic-sop-fallback", fallbackResult);
        await saveAiDecision(fallbackResult, data.metadata);
        return fallbackResult;
    }
}

async function drainInferenceQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;
    updateQueueMetric();

    while (inferenceQueue.length > 0) {
        const nextItem = inferenceQueue.shift();
        updateQueueMetric();
        try {
            const res = await processSingleBatch(nextItem.data);
            nextItem.resolve(res);
        } catch (err) {
            nextItem.resolve(undefined);
        }
    }

    isProcessingQueue = false;
    updateQueueMetric();
}

function analyzeRigStateAsync(data) {
    return new Promise((resolve) => {
        inferenceQueue.push({ data, resolve });
        updateQueueMetric();
        drainInferenceQueue();
    });
}

module.exports = {
    analyzeRigStateAsync,
    evaluateSopDeterministic,
    sanitizeJustification,
    getQueueStatus,
    telemetryEvents,
    getSopConfig,
    updateSopConfig,
    DEFAULT_SOP_CONFIG
};
