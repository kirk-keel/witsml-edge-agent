require('dotenv').config();
const express = require('express');
const path = require('path');
const {
    telemetryEvents,
    getSopConfig,
    getAllSopProfiles,
    updateSopConfig,
    getQueueStatus,
    checkOllamaHealth
} = require('./services/ai');
const {
    pool,
    getAllRigSops,
    getRecentAiDecisions,
    getRecentTelemetryBatches,
    getHourlyIltSummary,
    getFleetLeaderboard,
    checkDbHealth,
    getTelemetryStats
} = require('./services/db');
const { getRecentAlerts } = require('./utils/alerter');
const { getSpoolStatus } = require('./utils/spooler');
const { requireEdgeApiKey } = require('./utils/auth');
const { router: telemetryRouter } = require('./routes/telemetry');
const { register } = require('./utils/metrics');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// --- HEALTH & READINESS CHECKS ---
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', service: 'witsml-edge-agent' });
});

app.get('/ready', async (req, res) => {
    const [timescaledb, ollama] = await Promise.all([
        checkDbHealth(),
        checkOllamaHealth()
    ]);
    res.status(200).json({
        status: timescaledb.ok && ollama.ok ? 'ready' : 'degraded',
        timescaledb,
        ollama,
        queue: getQueueStatus(),
        spool: getSpoolStatus()
    });
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
    res.json(getSopConfig(req.query.rig_id));
});

app.get('/api/sops/profiles', async (req, res) => {
    const dbProfiles = await getAllRigSops();
    const memoryProfiles = getAllSopProfiles();
    res.json({
        default: memoryProfiles.default,
        rigs: memoryProfiles.rigs,
        persisted_rigs: dbProfiles
    });
});

app.post('/api/sops', requireEdgeApiKey, (req, res) => {
    const rigId = req.query.rig_id || req.body?.rig_id || null;
    const updated = updateSopConfig(req.body, rigId);
    res.json({ status: 'updated', rig_id: rigId || 'default', config: updated });
});

// --- DECISIONS, DDR CSV EXPORT, BATCHES, ALERTS & STATS ---
app.get('/api/decisions', async (req, res) => {
    const decisions = await getRecentAiDecisions({
        limit: req.query.limit,
        rig_id: req.query.rig_id,
        well_id: req.query.well_id,
        is_ilt: req.query.is_ilt
    });
    res.json({ decisions });
});

function escapeCsvCell(val) {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (/[",\r\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

app.get('/api/decisions/export', async (req, res) => {
    const decisions = await getRecentAiDecisions({
        limit: req.query.limit || 200,
        rig_id: req.query.rig_id,
        well_id: req.query.well_id,
        is_ilt: req.query.is_ilt
    });

    if (req.query.format === 'json') {
        res.setHeader('Content-Disposition', 'attachment; filename="witsml-ddr-decisions.json"');
        return res.json({ exported_at: new Date().toISOString(), count: decisions.length, decisions });
    }

    const headers = [
        'id',
        'timestamp',
        'rig_id',
        'well_id',
        'declared_op',
        'actual_state',
        'is_ilt',
        'ilt_duration_seconds',
        'ilt_cost_usd',
        'rop_fphr',
        'mse_psi',
        'hydraulic_status',
        'confidence_score',
        'justification'
    ];
    const lines = [headers.join(',')];
    for (const row of decisions) {
        lines.push(headers.map(h => escapeCsvCell(row[h])).join(','));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="witsml-ddr-decisions.csv"');
    return res.status(200).send(lines.join('\n') + '\n');
});

app.get('/api/batches', async (req, res) => {
    const batches = await getRecentTelemetryBatches({
        limit: req.query.limit,
        rig_id: req.query.rig_id
    });
    res.json({ batches });
});

app.get('/api/alerts', (req, res) => {
    res.json({ alerts: getRecentAlerts(req.query.limit) });
});

app.get('/api/stats', async (req, res) => {
    const stats = await getTelemetryStats();
    res.json({ ...stats, queue: getQueueStatus(), spool: getSpoolStatus() });
});

app.get('/api/stats/hourly', async (req, res) => {
    const buckets = await getHourlyIltSummary(req.query.hours);
    res.json({ buckets });
});

app.get('/api/fleet/leaderboard', async (req, res) => {
    const rigs = await getFleetLeaderboard();
    res.json({ rigs });
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
