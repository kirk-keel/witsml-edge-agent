const http = require('http');

const payloads = [
    {
        metadata: { rig_id: "Rig-412", active_operation: "drilling" },
        telemetry: [{ depth: 10000, wob: 15, rpm: 120, flow: 400, block_pos: 90, slips: false }]
    },
    {
        metadata: { rig_id: "Rig-412", active_operation: "drilling" },
        telemetry: [{ depth: 10030, wob: 18, rpm: 125, flow: 405, block_pos: 60, slips: false }]
    },
    {
        metadata: { rig_id: "Rig-412", active_operation: "connection" },
        telemetry: [
            // Simulating multiple data points over 180 seconds with pumps off and slips set
            { depth: 10060, wob: 0, rpm: 0, flow: 0, block_pos: 10, slips: true },
            { depth: 10060, wob: 0, rpm: 0, flow: 0, block_pos: 10, slips: true },
            { depth: 10060, wob: 0, rpm: 0, flow: 0, block_pos: 10, slips: true }
        ]
    }
];

async function sendPayload(data, scenario) {
    console.log(`\n[Simulator] Dispatching 5-minute window. Scenario: ${scenario}`);
    const postData = JSON.stringify(data);
    const options = {
        hostname: 'localhost',
        port: 3101, // Pointing to your externally mapped Docker port
        path: '/api/witsml',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    };

    return new Promise((resolve) => {
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                console.log(`[Simulator] Agent Status: ${res.statusCode} | ${body}`);
                resolve();
            });
        });
        req.on('error', (e) => console.error(`Error: ${e.message}`));
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

run();
