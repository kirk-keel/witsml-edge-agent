const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST || "timescaledb",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "witsml_secure_pw",
  database: process.env.DB_NAME || "witsml_telemetry",
  port: 5432,
  allowExitOnIdle: true,
});

let schemaChecked = false;
async function ensureDecisionColumns() {
  if (schemaChecked) return;
  try {
    await pool.query(`
      ALTER TABLE ai_decisions
        ADD COLUMN IF NOT EXISTS rig_id VARCHAR(50),
        ADD COLUMN IF NOT EXISTS well_id VARCHAR(50),
        ADD COLUMN IF NOT EXISTS declared_op VARCHAR(50),
        ADD COLUMN IF NOT EXISTS rop_fphr NUMERIC DEFAULT 0,
        ADD COLUMN IF NOT EXISTS mse_psi NUMERIC DEFAULT 0,
        ADD COLUMN IF NOT EXISTS hydraulic_status VARCHAR(50) DEFAULT 'normal',
        ADD COLUMN IF NOT EXISTS ilt_cost_usd NUMERIC DEFAULT 0;
      CREATE TABLE IF NOT EXISTS rig_sops (
        rig_id VARCHAR(50) PRIMARY KEY,
        min_wob NUMERIC NOT NULL DEFAULT 5,
        min_rpm NUMERIC NOT NULL DEFAULT 20,
        min_flow NUMERIC NOT NULL DEFAULT 100,
        max_conn_time INT NOT NULL DEFAULT 180,
        rig_day_rate_usd NUMERIC NOT NULL DEFAULT 72000,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE rig_sops
        ADD COLUMN IF NOT EXISTS rig_day_rate_usd NUMERIC NOT NULL DEFAULT 72000;
      CREATE INDEX IF NOT EXISTS idx_telemetry_batches_rig_time ON telemetry_batches (rig_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_ai_decisions_rig_time ON ai_decisions (rig_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_ai_decisions_is_ilt ON ai_decisions (is_ilt, timestamp DESC);
    `);
    await pool.query(`SELECT add_retention_policy('telemetry_batches', INTERVAL '30 days', if_not_exists => TRUE);`);
    await pool.query(`SELECT add_retention_policy('ai_decisions', INTERVAL '90 days', if_not_exists => TRUE);`);
    schemaChecked = true;
  } catch (err) {
    console.warn("[TimescaleDB] Could not verify schema/retention policies:", err.message);
  }
}

async function saveTelemetryBatch(rigId, wellId, payload) {
  try {
    await pool.query(
      "INSERT INTO telemetry_batches (rig_id, well_id, payload) VALUES ($1, $2, $3)",
      [rigId, wellId, JSON.stringify(payload)]
    );
    console.log("[TimescaleDB] Saved telemetry batch for " + rigId);
  } catch (err) {
    console.error("[TimescaleDB Error] Saving batch:", err.message);
  }
}

async function saveAiDecision(decision, metadata = {}) {
  try {
    await ensureDecisionColumns();
    const rigId = metadata.rig_id || decision.rig_id || null;
    const wellId = metadata.well_id || decision.well_id || null;
    const declaredOp = metadata.active_operation || decision.declared_op || null;

    await pool.query(
      `INSERT INTO ai_decisions
        (rig_id, well_id, declared_op, actual_state, is_ilt, ilt_duration_seconds, confidence_score, justification, rop_fphr, mse_psi, hydraulic_status, ilt_cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        rigId,
        wellId,
        declaredOp,
        decision.actual_state,
        decision.is_ilt,
        Math.round(Number(decision.ilt_duration_seconds) || 0),
        Number(decision.confidence_score) || 0,
        decision.justification,
        Number(decision.rop_fphr) || 0,
        Number(decision.mse_psi) || 0,
        decision.hydraulic_status || 'normal',
        Number(decision.ilt_cost_usd) || 0
      ]
    );
    console.log("[TimescaleDB] Saved AI decision: " + decision.actual_state);
  } catch (err) {
    console.error("[TimescaleDB Error] Saving AI decision:", err.message);
  }
}

async function upsertRigSop(rigId, sop) {
  try {
    await ensureDecisionColumns();
    await pool.query(
      `INSERT INTO rig_sops (rig_id, min_wob, min_rpm, min_flow, max_conn_time, rig_day_rate_usd, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (rig_id) DO UPDATE SET
         min_wob = EXCLUDED.min_wob,
         min_rpm = EXCLUDED.min_rpm,
         min_flow = EXCLUDED.min_flow,
         max_conn_time = EXCLUDED.max_conn_time,
         rig_day_rate_usd = EXCLUDED.rig_day_rate_usd,
         updated_at = NOW()`,
      [rigId, sop.min_wob, sop.min_rpm, sop.min_flow, sop.max_conn_time, sop.rig_day_rate_usd || 72000]
    );
  } catch (err) {
    console.warn("[TimescaleDB] Could not persist rig SOP:", err.message);
  }
}

async function getAllRigSops() {
  try {
    await ensureDecisionColumns();
    const { rows } = await pool.query(
      `SELECT rig_id, min_wob::float AS min_wob, min_rpm::float AS min_rpm, min_flow::float AS min_flow, max_conn_time::int AS max_conn_time, rig_day_rate_usd::float AS rig_day_rate_usd, updated_at
       FROM rig_sops
       ORDER BY rig_id ASC`
    );
    return rows;
  } catch (err) {
    return [];
  }
}

async function getRecentAiDecisions(options = 25) {
  try {
    await ensureDecisionColumns();
    const opts = typeof options === 'object' && options !== null ? options : { limit: options };
    const safeLimit = Math.min(Math.max(Number(opts.limit) || 25, 1), 500);

    const conditions = [];
    const values = [];

    if (opts.rig_id) {
      values.push(String(opts.rig_id));
      conditions.push(`rig_id = $${values.length}`);
    }
    if (opts.well_id) {
      values.push(String(opts.well_id));
      conditions.push(`well_id = $${values.length}`);
    }
    if (opts.is_ilt !== undefined && opts.is_ilt !== '') {
      const boolVal = opts.is_ilt === true || opts.is_ilt === 'true';
      values.push(boolVal);
      conditions.push(`is_ilt = $${values.length}`);
    }

    values.push(safeLimit);
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT id, timestamp, rig_id, well_id, declared_op, actual_state, is_ilt, ilt_duration_seconds, confidence_score, justification,
              COALESCE(rop_fphr, 0)::float AS rop_fphr,
              COALESCE(mse_psi, 0)::float AS mse_psi,
              COALESCE(hydraulic_status, 'normal') AS hydraulic_status,
              COALESCE(ilt_cost_usd, 0)::float AS ilt_cost_usd
       FROM ai_decisions
       ${whereClause}
       ORDER BY timestamp DESC
       LIMIT $${values.length}`,
      values
    );
    return rows;
  } catch (err) {
    console.error("[TimescaleDB Error] Fetching recent AI decisions:", err.message);
    return [];
  }
}

async function getRecentTelemetryBatches(options = {}) {
  try {
    const safeLimit = Math.min(Math.max(Number(options.limit) || 10, 1), 100);
    const values = [];
    let whereClause = '';
    if (options.rig_id) {
      values.push(String(options.rig_id));
      whereClause = `WHERE rig_id = $1`;
    }
    values.push(safeLimit);
    const { rows } = await pool.query(
      `SELECT id, timestamp, rig_id, well_id, payload
       FROM telemetry_batches
       ${whereClause}
       ORDER BY timestamp DESC
       LIMIT $${values.length}`,
      values
    );
    return rows;
  } catch (err) {
    console.error("[TimescaleDB Error] Fetching recent telemetry batches:", err.message);
    return [];
  }
}

async function getHourlyIltSummary(hours = 24) {
  try {
    await ensureDecisionColumns();
    const safeHours = Math.min(Math.max(Number(hours) || 24, 1), 720);
    const { rows } = await pool.query(
      `SELECT
         time_bucket('1 hour', timestamp) AS bucket,
         COALESCE(rig_id, 'Rig-412') AS rig_id,
         COUNT(*)::int AS total_decisions,
         COUNT(*) FILTER (WHERE is_ilt = true)::int AS ilt_events,
         COALESCE(SUM(ilt_duration_seconds) FILTER (WHERE is_ilt = true), 0)::int AS ilt_seconds,
         COALESCE(ROUND(SUM(ilt_cost_usd) FILTER (WHERE is_ilt = true), 2), 0)::float AS ilt_cost_usd,
         COALESCE(ROUND(AVG(confidence_score), 2), 0)::float AS avg_confidence
       FROM ai_decisions
       WHERE timestamp >= NOW() - ($1 || ' hours')::interval
       GROUP BY bucket, COALESCE(rig_id, 'Rig-412')
       ORDER BY bucket DESC`,
      [safeHours]
    );
    return rows;
  } catch (err) {
    console.error("[TimescaleDB Error] Fetching hourly ILT summary:", err.message);
    return [];
  }
}

async function checkDbHealth() {
  const start = Date.now();
  try {
    await pool.query('SELECT 1');
    return { ok: true, latency_ms: Date.now() - start };
  } catch (err) {
    return { ok: false, latency_ms: Date.now() - start, error: err.message };
  }
}

async function getTelemetryStats() {
  try {
    await ensureDecisionColumns();
    const batchRes = await pool.query(`SELECT COUNT(*)::int AS total_batches FROM telemetry_batches`);
    const decRes = await pool.query(`
      SELECT
        COUNT(*)::int AS total_decisions,
        COUNT(*) FILTER (WHERE is_ilt = true)::int AS ilt_count,
        COUNT(*) FILTER (WHERE is_ilt = false)::int AS normal_count,
        COALESCE(SUM(ilt_duration_seconds) FILTER (WHERE is_ilt = true), 0)::int AS total_ilt_seconds,
        COALESCE(ROUND(SUM(ilt_cost_usd) FILTER (WHERE is_ilt = true), 2), 0)::float AS total_ilt_cost_usd,
        COALESCE(ROUND(AVG(rop_fphr) FILTER (WHERE rop_fphr > 0), 2), 0)::float AS avg_rop_fphr,
        COALESCE(ROUND(AVG(mse_psi) FILTER (WHERE mse_psi > 0), 0), 0)::float AS avg_mse_psi,
        COALESCE(ROUND(AVG(confidence_score), 2), 0)::float AS avg_confidence
      FROM ai_decisions
    `);
    return {
      total_batches: batchRes.rows[0]?.total_batches ?? 0,
      ...(decRes.rows[0] || {
        total_decisions: 0,
        ilt_count: 0,
        normal_count: 0,
        total_ilt_seconds: 0,
        total_ilt_cost_usd: 0,
        avg_rop_fphr: 0,
        avg_mse_psi: 0,
        avg_confidence: 0
      })
    };
  } catch (err) {
    console.error("[TimescaleDB Error] Fetching telemetry stats:", err.message);
    return {
      total_batches: 0,
      total_decisions: 0,
      ilt_count: 0,
      normal_count: 0,
      total_ilt_seconds: 0,
      total_ilt_cost_usd: 0,
      avg_rop_fphr: 0,
      avg_mse_psi: 0,
      avg_confidence: 0
    };
  }
}

module.exports = {
  pool,
  saveTelemetryBatch,
  saveAiDecision,
  upsertRigSop,
  getAllRigSops,
  getRecentAiDecisions,
  getRecentTelemetryBatches,
  getHourlyIltSummary,
  checkDbHealth,
  getTelemetryStats
};
