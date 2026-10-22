const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../src/index');
const {
    DEFAULT_SOP_CONFIG,
    updateSopConfig,
    evaluateSopDeterministic,
    sanitizeJustification,
    compactTelemetryForPrompt
} = require('../src/services/ai');
const { computeDrillingMechanics } = require('../src/utils/mechanics');

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
        assert.match(text, /witsml_ilt_cost_usd_total/);
        assert.match(text, /witsml_drilling_rop_fphr/);
        assert.match(text, /witsml_drilling_mse_psi/);
    });

    it('computeDrillingMechanics computes ROP, Teale MSE, hydraulic status, and ILT cost', () => {
        const start = Date.now();
        const mech = computeDrillingMechanics(
            {
                telemetry: [
                    {
                        timestamp: new Date(start).toISOString(),
                        hole_depth_ft: 10000,
                        bit_depth_ft: 10000,
                        wob_klbs: 20,
                        rpm: 120,
                        flow_in_gpm: 400,
                        spp_psi: 2800
                    },
                    {
                        timestamp: new Date(start + 300000).toISOString(),
                        hole_depth_ft: 10008,
                        bit_depth_ft: 10008,
                        wob_klbs: 20,
                        rpm: 120,
                        flow_in_gpm: 400,
                        spp_psi: 2800
                    }
                ]
            },
            { rig_day_rate_usd: 72000 },
            120
        );
        assert.equal(mech.rop_fphr, 96);
        assert.ok(mech.mse_psi > 1000);
        assert.equal(mech.hydraulic_status, 'normal');
        assert.equal(mech.ilt_cost_usd, 100);

        const washout = computeDrillingMechanics(
            {
                telemetry: [
                    { hole_depth_ft: 10000, wob_klbs: 18, rpm: 110, flow_in_gpm: 420, spp_psi: 900 },
                    { hole_depth_ft: 10005, wob_klbs: 18, rpm: 110, flow_in_gpm: 420, spp_psi: 900 }
                ]
            },
            { rig_day_rate_usd: 72000 },
            0
        );
        assert.equal(washout.hydraulic_status, 'washout_risk');
        assert.ok(washout.rop_fphr > 0);
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
        assert.equal(
            sanitizeJustification(
                'Actual WOB 18 is < min 5 required, RPM 125 is < min 20 required, Flow 405 is < min 100 required.',
                normalDrilling
            ),
            'Actual WOB 18 is > min 5 required, RPM 125 is > min 20 required, Flow 405 is > min 100 required.'
        );

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

        const manyPoints = Array.from({ length: 10 }, (_, i) => ({
            wob_klbs: 20,
            rpm: 120,
            flow_in_gpm: 400,
            spp_psi: 2800,
            hook_load_klbs: 240,
            seq: i
        }));
        const compacted = JSON.parse(compactTelemetryForPrompt(manyPoints));
        assert.equal(compacted.points_count, 10);
        assert.equal(compacted.window_averages.wob_klbs, 20);
        assert.equal(compacted.window_averages.flow_in_gpm, 400);

        const drillingDysfunction = evaluateSopDeterministic(
            {
                metadata: {
                    active_operation: 'drilling',
                    window_start: new Date(start).toISOString(),
                    window_end: new Date(start + 300000).toISOString(),
                    interval_seconds: 10
                },
                telemetry: [{ wob_klbs: 2, rpm: 10, flow_in_gpm: 80 }]
            },
            DEFAULT_SOP_CONFIG
        );
        assert.equal(drillingDysfunction.is_ilt, true);
        assert.equal(drillingDysfunction.actual_state, 'drilling_dysfunction');
        assert.equal(drillingDysfunction.ilt_duration_seconds, 180);

        const circulatingLoss = evaluateSopDeterministic(
            {
                metadata: {
                    active_operation: 'circulating',
                    window_start: new Date(start).toISOString(),
                    window_end: new Date(start + 300000).toISOString(),
                    interval_seconds: 10
                },
                telemetry: [{ wob_klbs: 0, rpm: 0, flow_in_gpm: 40 }]
            },
            DEFAULT_SOP_CONFIG
        );
        assert.equal(circulatingLoss.is_ilt, true);
        assert.equal(circulatingLoss.actual_state, 'circulation_loss');
    });

    it('GET and POST /api/sops manage global and per-rig runtime SOP thresholds', async () => {
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
            max_conn_time: 210,
            rig_day_rate_usd: 72000
        });

        const rigSopRes = await fetch(`${baseUrl}/api/sops`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rig_id: 'Rig-501', min_wob: 8, min_rpm: 30, min_flow: 180, max_conn_time: 150 })
        });
        assert.equal(rigSopRes.status, 200);

        const getRigSop = await (await fetch(`${baseUrl}/api/sops?rig_id=Rig-501`)).json();
        assert.equal(getRigSop.min_wob, 8);
        assert.equal(getRigSop.max_conn_time, 150);

        const profilesRes = await (await fetch(`${baseUrl}/api/sops/profiles`)).json();
        assert.equal(profilesRes.rigs['Rig-501'].min_wob, 8);
    });

    it('POST /api/v1/witsml/xml parses native WITSML XML into canonical telemetry', async () => {
        const now = new Date().toISOString();
        const xmlPayload = `<logs xmlns="http://www.witsml.org/schemas/1series" version="1.4.1.1">
  <log uidWell="WL-9924" uidWellbore="Rig-412">
    <nameWell>WL-9924</nameWell>
    <nameWellbore>Rig-412</nameWellbore>
    <activeOperation>drilling</activeOperation>
    <logData>
      <mnemonicList>TIME,DEPT,DBTM,BPOS,HKLD,WOB,SPPA,MFIA,RPM</mnemonicList>
      <data>${now},10120,10120,55,242,19.5,2890,415,128</data>
    </logData>
  </log>
</logs>`;
        const res = await fetch(`${baseUrl}/api/v1/witsml/xml`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/xml' },
            body: xmlPayload
        });
        assert.equal(res.status, 202);
        const body = await res.json();
        assert.equal(body.status, 'accepted');
        assert.equal(body.format, 'witsml_xml');
        assert.equal(body.rig_id, 'Rig-412');
        assert.equal(body.points_ingested, 1);

        const badRes = await fetch(`${baseUrl}/api/v1/witsml/xml`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/xml' },
            body: 'not-xml'
        });
        assert.equal(badRes.status, 400);
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
            /witsml_telemetry_batches_total\{rig_id="Rig-412",well_id="WL-9924",active_operation="drilling",status="accepted"\} 2/
        );
        assert.match(
            metricsText,
            /witsml_telemetry_points_total\{rig_id="Rig-412",well_id="WL-9924"\} 3/
        );
    });

    it('GET /api/decisions, GET /api/batches, GET /api/stats, and GET /ready return structured responses', async () => {
        const decRes = await fetch(`${baseUrl}/api/decisions?limit=5&is_ilt=true&rig_id=Rig-412`);
        assert.equal(decRes.status, 200);
        const decBody = await decRes.json();
        assert.ok(Array.isArray(decBody.decisions));

        const batchRes = await fetch(`${baseUrl}/api/batches?limit=5&rig_id=Rig-412`);
        assert.equal(batchRes.status, 200);
        const batchBody = await batchRes.json();
        assert.ok(Array.isArray(batchBody.batches));

        const statsRes = await fetch(`${baseUrl}/api/stats`);
        assert.equal(statsRes.status, 200);
        const statsBody = await statsRes.json();
        assert.equal(typeof statsBody.total_batches, 'number');
        assert.equal(typeof statsBody.total_decisions, 'number');
        assert.equal(typeof statsBody.queue?.total_pending, 'number');

        const readyRes = await fetch(`${baseUrl}/ready`);
        assert.equal(readyRes.status, 200);
        const readyBody = await readyRes.json();
        assert.ok(['ready', 'degraded'].includes(readyBody.status));
        assert.equal(typeof readyBody.timescaledb?.ok, 'boolean');
        assert.equal(typeof readyBody.ollama?.ok, 'boolean');

        const csvRes = await fetch(`${baseUrl}/api/decisions/export?format=csv`);
        assert.equal(csvRes.status, 200);
        assert.match(csvRes.headers.get('content-type'), /text\/csv/);
        const csvText = await csvRes.text();
        assert.match(
            csvText,
            /^id,timestamp,rig_id,well_id,declared_op,actual_state,is_ilt,ilt_duration_seconds,ilt_cost_usd,rop_fphr,mse_psi,hydraulic_status,confidence_score,justification/
        );

        const alertsRes = await fetch(`${baseUrl}/api/alerts`);
        assert.equal(alertsRes.status, 200);
        const alertsBody = await alertsRes.json();
        assert.ok(Array.isArray(alertsBody.alerts));

        const hourlyRes = await fetch(`${baseUrl}/api/stats/hourly?hours=12`);
        assert.equal(hourlyRes.status, 200);
        const hourlyBody = await hourlyRes.json();
        assert.ok(Array.isArray(hourlyBody.buckets));
    });

    it('requireEdgeApiKey enforces X-Edge-Key when EDGE_API_KEY is configured', async () => {
        process.env.EDGE_API_KEY = 'secret-edge-token';
        try {
            const unauthRes = await fetch(`${baseUrl}/api/sops`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ min_wob: 10 })
            });
            assert.equal(unauthRes.status, 401);

            const authRes = await fetch(`${baseUrl}/api/sops`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Edge-Key': 'secret-edge-token'
                },
                body: JSON.stringify({ min_wob: 10 })
            });
            assert.equal(authRes.status, 200);
        } finally {
            delete process.env.EDGE_API_KEY;
        }
    });
});
