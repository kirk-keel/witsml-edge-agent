const express = require('express');
const path = require('path');
const fs = require('fs');
const { analyzeRigStateAsync } = require('./services/ai');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// --- DASHBOARD ROUTING & LIVE STREAM ---
app.use(express.static(path.join(__dirname, '../public')));

const configPath = path.join(__dirname, 'sop-config.json');

app.get('/api/sops', (req, res) => {
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, JSON.stringify({ min_wob: 5, min_rpm: 20, min_flow: 100, max_conn_time: 180 }));
    }
    res.sendFile(configPath);
});

app.post('/api/sops', (req, res) => {
    fs.writeFileSync(configPath, JSON.stringify(req.body, null, 2));
    res.json({ status: 'updated' });
});

let clients = [];
app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    clients.push(res);
    req.on('close', () => { clients = clients.filter(c => c !== res); });
});

global.broadcastToDashboard = (aiResult) => {
    clients.forEach(client => client.write(`data: ${JSON.stringify(aiResult)}\n\n`));
};

// --- WITSML INGESTION ROUTE ---
app.post('/api/witsml', async (req, res) => {
    console.log(`[Agent] Received telemetry payload for ${req.body.metadata?.rig_id || 'Unknown Rig'}`);
    
    // Instantly return a 202 Accepted so the simulator doesn't hang waiting for the AI
    res.status(202).json({ status: "processing", message: "Payload queued for Qwen 3B analysis" });
    
    // Pass to the local homelab AI Model asynchronously
    try {
        await analyzeRigStateAsync(req.body);
    } catch (error) {
        console.error("[Agent Error] AI Processing Failed:", error);
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`WITSML Edge Agent running on port ${PORT}`);
});
