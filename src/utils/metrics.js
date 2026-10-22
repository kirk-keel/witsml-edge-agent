const client = require('prom-client');

const register = new client.Registry();

client.collectDefaultMetrics({
    register,
    prefix: 'witsml_agent_'
});

const telemetryIngestionCounter = new client.Counter({
    name: 'witsml_telemetry_batches_total',
    help: 'Total number of WITSML telemetry batches received',
    labelNames: ['rig_id', 'well_id', 'active_operation', 'status'],
    registers: [register]
});

const telemetryPointsCounter = new client.Counter({
    name: 'witsml_telemetry_points_total',
    help: 'Total number of individual WITSML sensor data points ingested',
    labelNames: ['rig_id', 'well_id'],
    registers: [register]
});

const aiInferenceLatencyHistogram = new client.Histogram({
    name: 'witsml_ai_inference_duration_seconds',
    help: 'Latency of LangChain/Ollama AI rig state evaluation in seconds',
    labelNames: ['model', 'status'],
    buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
    registers: [register]
});

const iltDetectionCounter = new client.Counter({
    name: 'witsml_ilt_detections_total',
    help: 'Total number of Invisible Lost Time (ILT) events detected by AI evaluation',
    labelNames: ['rig_id', 'well_id', 'actual_state'],
    registers: [register]
});

const iltDurationSecondsCounter = new client.Counter({
    name: 'witsml_ilt_duration_seconds_total',
    help: 'Cumulative Invisible Lost Time (ILT) duration in seconds detected',
    labelNames: ['rig_id', 'well_id', 'actual_state'],
    registers: [register]
});

const aiDecisionsCounter = new client.Counter({
    name: 'witsml_ai_decisions_total',
    help: 'Total number of AI rig state decisions recorded',
    labelNames: ['rig_id', 'well_id', 'actual_state', 'is_ilt'],
    registers: [register]
});

const aiQueueDepthGauge = new client.Gauge({
    name: 'witsml_ai_queue_depth',
    help: 'Current number of telemetry batches waiting or actively running in the AI inference queue',
    registers: [register]
});

const alertWebhooksCounter = new client.Counter({
    name: 'witsml_alert_events_total',
    help: 'Total number of ILT alert events triggered and dispatched',
    labelNames: ['rig_id', 'severity', 'status'],
    registers: [register]
});

module.exports = {
    register,
    telemetryIngestionCounter,
    telemetryPointsCounter,
    aiInferenceLatencyHistogram,
    iltDetectionCounter,
    iltDurationSecondsCounter,
    aiDecisionsCounter,
    aiQueueDepthGauge,
    alertWebhooksCounter
};
