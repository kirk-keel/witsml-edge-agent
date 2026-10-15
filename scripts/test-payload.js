const http = require('http');

const metadata = {
    well_id: "WL-9924",
    rig_id: "RIG-412",
    window_start: new Date().toISOString(),
    window_end: new Date(Date.now() + 5 * 60000).toISOString(),
    interval_seconds: 10,
    active_operation: "drilling" 
};

// Generate 30 static data points simulating 5 minutes of pumps off / block static
const telemetry = Array.from({ length: 30 }).map((_, index) => {
    return {
        timestamp: new Date(Date.now() + index * 10000).toISOString(),
        hole_depth_ft: 14250.0,
        bit_depth_ft: 14250.0,
        block_pos_ft: 25.4, 
        hook_load_klbs: 310.5, 
        wob_klbs: 0.0, 
        spp_psi: 0, 
        flow_in_gpm: 0, 
        rpm: 0 
    };
});

const payload = JSON.stringify({ metadata, telemetry });

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/v1/telemetry',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
};

const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => console.log(`[Edge Aggregator] API Response: ${data}`));
});

req.write(payload);
req.end();
