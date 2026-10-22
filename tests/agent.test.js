const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../src/index');
const { DEFAULT_SOP_CONFIG, updateSopConfig, evaluateSopDeterministic } = require('../src/services/ai');

const sopFilePath = path.join(__dirname, '../src/sop-config.json');

describe('WITSML Edge Agent API & Telemetry Pipeline', () => {
    let server;
    let baseUrl;

    before(async () => {
        await new Promise((resolve) => {
            server = app.listen(0, '127.0.0.1', () => {
                const { port } = server.address();
                baseUrl = `http://127.0.0.1:${port}`;
                resolve();
            });
        });
    });

    after(async () => {
        updateSopConfig(DEFAULT_SOP_CONFIG);
        if (fs.existsSync(sopFilePath)) {
            fs.unlinkSync(sopFilePath);
        }
        await new Promise((resolve) => server.close(resolve));
    });

    it('GET /health returns 200 healthy status', async () => {
        const res = await fetch(`${baseUrl}/health`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.deepEqual(body, { status: 'healthy', service: 'witsml-edge-agent' });
    });

    it('GET /metrics exposes Prometheus metrics for telemetry, AI latency, ILT, and queue depth', async () => {
        const res = await fetch(`${baseUrl}/metrics`);
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type'), /text\/plain/);
        const text = await res.text();
        assert.match(text, /witsml_telemetry_batches_total/);
        assert.match(text, /witsml_telemetry_points_total/);
        assert.match(text, /witsml_ai_inference_duration_seconds/);
        assert.match(text, /witsml_ilt_detections_total/);
        assert.match(text, /witsml_ilt_duration_seconds_total/);
        assert.match(text, /witsml_ai_decisions_total/);
        assert.match(text, /witsml_ai_queue_depth/);
    });

    it('evaluateSopDeterministic prevents false-positive ILT on normal drilling and flags connection ILT', () => {
        const start = Date.now();
        const normalDrilling = evaluateSopDeterministic(
            {
                metadata: {
                    active_operation: 'drilling',
                    window_start: new Date(start).toISOString(),
                    window_end: new Date(start + 300000).toISOString(),
                    interval_seconds: 10
                },
                telemetry: [{ wob_klbs: 18, rpm: 125, flow_in_gpm: 405 }]
            },
            DEFAULT_SOP_CONFIG
        );
        assert.equal(normalDrilling.is_ilt, false);
        assert.equal(normalDrilling.ilt_duration_seconds, 0);
        assert.equal(normalDrilling.actual_state, 'drilling');

        const connectionIlt = evaluateSopDeterministic(
            {
                metadata: {
                    active_operation: 'connection',
                    window_start: new Date(start).toISOString(),
                    window_end: new Date(start + 300000).toISOString(),
                    interval_seconds: 10
                },
                telemetry: [
                    { wob_klbs: 0, rpm: 0, flow_in_gpm: 0 },
                    { wob_klbs: 0, rpm: 0, flow_in_gpm: 0 },
                    { wob_klbs: 0, rpm: 0, flow_in_gpm: 0 }
                ]
            },
            DEFAULT_SOP_CONFIG
        );
        assert.equal(connectionIlt.is_ilt, true);
        assert.equal(connectionIlt.ilt_duration_seconds, 120);
        assert.equal(connectionIlt.actual_state, 'connection');
    });

    it('GET and POST /api/sops manage runtime SOP thresholds', async () => {
        const getRes = await fetch(`${baseUrl}/api/sops`);
        assert.equal(getRes.status, 200);
        const initialSops = await getRes.json();
        assert.equal(typeof initialSops.min_wob, 'number');

        const postRes = await fetch(`${baseUrl}/api/sops`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ min_wob: 12, min_rpm: 40, min_flow: 250, max_conn_time: 210 })
        });
        assert.equal(postRes.status, 200);
        const updatedBody = await postRes.json();
        assert.equal(updatedBody.status, 'updated');
        assert.deepEqual(updatedBody.config, {
            min_wob: 12,
            min_rpm: 40,
            min_flow: 250,
            max_conn_time: 210
        });
    });

    it('POST /api/v1/telemetry rejects malformed payload with 400 and increments validation_error metric', async () => {
        const res = await fetch(`${baseUrl}/api/v1/telemetry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                metadata: { rig_id: 'Rig-Test', well_id: 'WL-Test', active_operation: 'drilling' },
                telemetry: []
            })
        });
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.status, 'error');
        assert.equal(body.message, 'Invalid schema');

        const metricsText = await (await fetch(`${baseUrl}/metrics`)).text();
        assert.match(
            metricsText,
            /witsml_telemetry_batches_total\{rig_id="Rig-Test",well_id="WL-Test",active_operation="drilling",status="validation_error"\} 1/
        );
    });

    it('POST /api/v1/telemetry accepts schema-valid payload with 202 and increments ingestion metrics', async () => {
        const now = new Date().toISOString();
        const validPayload = {
            metadata: {
                well_id: 'WL-9924',
                rig_id: 'Rig-412',
                window_start: now,
                window_end: now,
                interval_seconds: 10,
                active_operation: 'drilling'
            },
            telemetry: [
                {
                    timestamp: now,
                    hole_depth_ft: 10000,
                    bit_depth_ft: 10000,
                    block_pos_ft: 90,
                    hook_load_klbs: 240,
                    wob_klbs: 18,
                    spp_psi: 2850,
                    flow_in_gpm: 400,
                    rpm: 120
                },
                {
                    timestamp: now,
                    hole_depth_ft: 10005,
                    bit_depth_ft: 10005,
                    block_pos_ft: 85,
                    hook_load_klbs: 241,
                    wob_klbs: 19,
                    spp_psi: 2860,
                    flow_in_gpm: 405,
                    rpm: 122
                }
            ]
        };

        const res = await fetch(`${baseUrl}/api/v1/telemetry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(validPayload)
        });
        assert.equal(res.status, 202);
        const body = await res.json();
        assert.equal(body.status, 'accepted');
        assert.equal(body.rig_id, 'Rig-412');
        assert.equal(body.well_id, 'WL-9924');

        const metricsText = await (await fetch(`${baseUrl}/metrics`)).text();
        assert.match(
            metricsText,
            /witsml_telemetry_batches_total\{rig_id="Rig-412",well_id="WL-9924",active_operation="drilling",status="accepted"\} 1/
        );
        assert.match(
            metricsText,
            /witsml_telemetry_points_total\{rig_id="Rig-412",well_id="WL-9924"\} 2/
        );
    });

    it('GET /api/decisions and GET /api/stats return structured responses', async () => {
        const decRes = await fetch(`${baseUrl}/api/decisions?limit=5`);
        assert.equal(decRes.status, 200);
        const decBody = await decRes.json();
        assert.ok(Array.isArray(decBody.decisions));

        const statsRes = await fetch(`${baseUrl}/api/stats`);
        assert.equal(statsRes.status, 200);
        const statsBody = await statsRes.json();
        assert.equal(typeof statsBody.total_batches, 'number');
        assert.equal(typeof statsBody.total_decisions, 'number');
        assert.equal(typeof statsBody.queue?.total_pending, 'number');
    });
});
