require('dotenv').config();
const express = require('express');
const path = require('path');
const { telemetryEvents, getSopConfig, updateSopConfig } = require('./services/ai');
const { router: telemetryRouter } = require('./routes/telemetry');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// --- HEALTH CHECK ---
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', service: 'witsml-edge-agent' });
});

// --- DASHBOARD ROUTING & SOP CONFIG ---
app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/sops', (req, res) => {
    res.json(getSopConfig());
});

app.post('/api/sops', (req, res) => {
    const updated = updateSopConfig(req.body);
    res.json({ status: 'updated', config: updated });
});

// --- SERVER-SENT EVENTS (SSE) STREAM via EventEmitter ---
app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const onAssessment = (aiResult) => {
        res.write(`data: ${JSON.stringify(aiResult)}\n\n`);
    };

    telemetryEvents.on('assessment', onAssessment);
    req.on('close', () => {
        telemetryEvents.off('assessment', onAssessment);
    });
});

// --- WITSML TELEMETRY INGESTION ROUTES ---
app.use('/', telemetryRouter);

if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`WITSML Edge Agent running on port ${PORT}`);
    });
}

module.exports = app;
