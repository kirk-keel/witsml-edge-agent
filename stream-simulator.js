const http = require('http');
const https = require('https');

const AGENT_URL =
    process.env.AGENT_URL ||
    (process.env.PORT ? `http://127.0.0.1:${process.env.PORT}` : 'https://agent.kcklayton.com');

function makeWindow(activeOperation, points, rigId = "Rig-412", wellId = "WL-9924") {
    const start = Date.now();
    return {
        metadata: {
            well_id: wellId,
            rig_id: rigId,
            window_start: new Date(start).toISOString(),
            window_end: new Date(start + 5 * 60000).toISOString(),
            interval_seconds: 10,
            active_operation: activeOperation
        },
        telemetry: points.map((pt, i) => ({
            timestamp: new Date(start + i * 10000).toISOString(),
            hole_depth_ft: pt.depth,
            bit_depth_ft: pt.depth,
            block_pos_ft: pt.block_pos,
            hook_load_klbs: pt.hook_load ?? 240.0,
            wob_klbs: pt.wob,
            spp_psi: pt.spp ?? 2850,
            flow_in_gpm: pt.flow,
            rpm: pt.rpm
        }))
    };
}

const payloads = [
    makeWindow("drilling", [
        { depth: 10000, wob: 15, rpm: 120, flow: 400, block_pos: 90 }
    ]),
    makeWindow("drilling", [
        { depth: 10030, wob: 18, rpm: 125, flow: 405, block_pos: 60 }
    ]),
    makeWindow("connection", [
        // Simulating multiple data points over 180 seconds with pumps off and slips set
        { depth: 10060, wob: 0, rpm: 0, flow: 0, spp: 0, block_pos: 10 },
        { depth: 10060, wob: 0, rpm: 0, flow: 0, spp: 0, block_pos: 10 },
        { depth: 10060, wob: 0, rpm: 0, flow: 0, spp: 0, block_pos: 10 }
    ])
];

async function sendPayload(data, scenario) {
    console.log(`\n[Simulator] Dispatching 5-minute window to ${AGENT_URL}. Scenario: ${scenario}`);
    const postData = JSON.stringify(data);
    const parsedUrl = new URL('/api/v1/telemetry', AGENT_URL);
    const transport = parsedUrl.protocol === 'https:' ? https : http;

    const headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
    };
    if (process.env.EDGE_API_KEY) {
        headers['X-Edge-Key'] = process.env.EDGE_API_KEY;
    }

    const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname,
        method: 'POST',
        headers
    };

    return new Promise((resolve) => {
        const req = transport.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                console.log(`[Simulator] Agent Status: ${res.statusCode} | ${body}`);
                resolve();
            });
        });
        req.on('error', (e) => {
            console.error(`Error: ${e.message}`);
            resolve();
        });
        req.write(postData);
        req.end();
    });
}

async function runContinuous(intervalMs = 15000) {
    console.log(`[Simulator] Starting continuous advancing-depth WITSML stream (interval=${intervalMs}ms)...`);
    let depth = 10090;
    let step = 0;
    const cycle = [
        { op: 'drilling', scenario: 'normal_drilling', wob: 18.5, rpm: 124, flow: 410, spp: 2875, block: 75, dDepth: 15 },
        { op: 'drilling', scenario: 'normal_drilling', wob: 19.2, rpm: 128, flow: 415, spp: 2910, block: 60, dDepth: 15 },
        { op: 'drilling', scenario: 'drilling_dysfunction_ilt', wob: 3.0, rpm: 14, flow: 90, spp: 1850, block: 45, dDepth: 2 },
        { op: 'connection', scenario: 'connection_ilt', wob: 0, rpm: 0, flow: 0, spp: 0, block: 12, dDepth: 0 }
    ];

    while (true) {
        const cfg = cycle[step % cycle.length];
        depth += cfg.dDepth;
        const pts = cfg.op === 'connection'
            ? [
                { depth, wob: 0, rpm: 0, flow: 0, spp: 0, block_pos: cfg.block },
                { depth, wob: 0, rpm: 0, flow: 0, spp: 0, block_pos: cfg.block },
                { depth, wob: 0, rpm: 0, flow: 0, spp: 0, block_pos: cfg.block }
            ]
            : [{ depth, wob: cfg.wob, rpm: cfg.rpm, flow: cfg.flow, spp: cfg.spp, block_pos: cfg.block }];

        await sendPayload(makeWindow(cfg.op, pts), `${cfg.scenario} @ ${depth}ft`);
        step++;
        await new Promise(r => setTimeout(r, intervalMs));
    }
}

async function run() {
    if (process.argv.includes('--continuous')) {
        return runContinuous(Number(process.env.SIM_INTERVAL_MS) || 15000);
    }
    console.log("[Simulator] Initializing Schema-Compliant WITSML Stream...");
    await sendPayload(payloads[0], "normal_drilling");
    await new Promise(r => setTimeout(r, 2000));
    await sendPayload(payloads[1], "normal_drilling");
    await new Promise(r => setTimeout(r, 2000));
    await sendPayload(payloads[2], "ilt_connection");
}

if (require.main === module) {
    run();
}

module.exports = { makeWindow, sendPayload };
