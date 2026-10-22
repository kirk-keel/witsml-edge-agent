const http = require('http');
const https = require('https');

const AGENT_URL = process.env.AGENT_URL || `https://agent.kcklayton.com:${process.env.PORT || 443}`;

function makeWindow(activeOperation, points) {
    const start = Date.now();
    return {
        metadata: {
            well_id: "WL-9924",
            rig_id: "Rig-412",
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

    const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
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

async function run() {
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
