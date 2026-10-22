require('dotenv').config();
const express = require('express');
const path = require('path');
const { telemetryEvents, getSopConfig, updateSopConfig, getQueueStatus } = require('./services/ai');
const { pool, getRecentAiDecisions, getTelemetryStats } = require('./services/db');
const { router: telemetryRouter } = require('./routes/telemetry');
const { register } = require('./utils/metrics');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// --- HEALTH CHECK ---
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', service: 'witsml-edge-agent' });
});

// --- PROMETHEUS METRICS ---
app.get('/metrics', async (req, res) => {
    try {
        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
    } catch (error) {
        res.status(500).end(error.message);
    }
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

app.get('/api/decisions', async (req, res) => {
    const decisions = await getRecentAiDecisions(req.query.limit);
    res.json({ decisions });
});

app.get('/api/stats', async (req, res) => {
    const stats = await getTelemetryStats();
    res.json({ ...stats, queue: getQueueStatus() });
});

// --- SERVER-SENT EVENTS (SSE) STREAM via EventEmitter ---
app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(': connected\n\n');

    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 25000);

    const onAssessment = (aiResult) => {
        res.write(`data: ${JSON.stringify(aiResult)}\n\n`);
    };

    telemetryEvents.on('assessment', onAssessment);
    req.on('close', () => {
        clearInterval(heartbeat);
        telemetryEvents.off('assessment', onAssessment);
    });
});

// --- WITSML TELEMETRY INGESTION ROUTES ---
app.use('/', telemetryRouter);

if (require.main === module) {
    const server = app.listen(PORT, '0.0.0.0', () => {
        console.log(`WITSML Edge Agent running on port ${PORT}`);
    });

    const shutdown = (signal) => {
        console.log(`[Agent] Received ${signal}, shutting down gracefully...`);
        server.close(() => {
            pool.end().catch(() => {}).finally(() => process.exit(0));
        });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
