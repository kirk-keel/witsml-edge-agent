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
    aiDecisionsCounter
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

const outputParser = StructuredOutputParser.fromZodSchema(
    z.object({
        actual_state: z.string(),
        is_ilt: z.boolean(),
        ilt_duration_seconds: z.number(),
        confidence_score: z.number(),
        justification: z.string().describe("Strict engineering logic. State the exact numeric comparisons factually without hallucinating (e.g., 'Actual WOB 18 is > min 5 required').")
    })
);

async function analyzeRigStateAsync(data) {
    const modelName = process.env.OLLAMA_MODEL_NAME || "qwen2.5:1.5b";
    const endTimer = aiInferenceLatencyHistogram.startTimer({ model: modelName });
    try {
        const sopConfig = getSopConfig();

        const model = new ChatOllama({
            baseUrl: process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || "http://localhost:11434",
            model: modelName,
            temperature: 0,
            format: "json"
        });

        const prompt = new PromptTemplate({
            template: `Analyze this WITSML telemetry against the Operating Rules.
### Rules:
1. Drilling: WOB > {min_wob}, RPM > {min_rpm}, Flow > {min_flow}.
2. Connection: Max {max_conn_time}s.

### Payload:
Declared: {declared_op}
Telemetry: {telemetry_data}

### Output:
{format_instructions}
Output raw JSON. Your 'justification' field must strictly state the factual math (e.g., 'Actual Flow 400 is > required 100'). Do not contradict the telemetry.`,
            inputVariables: ["declared_op", "telemetry_data", "min_wob", "min_rpm", "min_flow", "max_conn_time"],
            partialVariables: { format_instructions: outputParser.getFormatInstructions() }
        });

        const chain = prompt.pipe(model).pipe(outputParser);
        const result = await chain.invoke({
            declared_op: data.metadata.active_operation,
            telemetry_data: JSON.stringify(data.telemetry),
            min_wob: sopConfig.min_wob,
            min_rpm: sopConfig.min_rpm,
            min_flow: sopConfig.min_flow,
            max_conn_time: sopConfig.max_conn_time
        });

        endTimer({ status: 'success' });

        const rig_id = data.metadata.rig_id;
        const well_id = data.metadata.well_id;
        const actual_state = result.actual_state || 'unknown';

        aiDecisionsCounter.inc({
            rig_id,
            well_id,
            actual_state,
            is_ilt: String(Boolean(result.is_ilt))
        });

        if (result.is_ilt) {
            iltDetectionCounter.inc({ rig_id, well_id, actual_state });
            const durationSec = Math.max(0, Number(result.ilt_duration_seconds) || 0);
            if (durationSec > 0) {
                iltDurationSecondsCounter.inc({ rig_id, well_id, actual_state }, durationSec);
            }
        }

        telemetryEvents.emit('assessment', result);
        logAiDecision(data.metadata, "local-compute-0-cost", result);
        await saveAiDecision(result);
        return result;
    } catch (error) {
        endTimer({ status: 'error' });
        console.error("[Agent Error] AI Processing Failed:", error);
    }
}

module.exports = {
    analyzeRigStateAsync,
    telemetryEvents,
    getSopConfig,
    updateSopConfig,
    DEFAULT_SOP_CONFIG
};
