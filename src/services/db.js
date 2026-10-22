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
        ADD COLUMN IF NOT EXISTS declared_op VARCHAR(50);
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
      "INSERT INTO ai_decisions (rig_id, well_id, declared_op, actual_state, is_ilt, ilt_duration_seconds, confidence_score, justification) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [
        rigId,
        wellId,
        declaredOp,
        decision.actual_state,
        decision.is_ilt,
        Math.round(Number(decision.ilt_duration_seconds) || 0),
        Number(decision.confidence_score) || 0,
        decision.justification
      ]
    );
    console.log("[TimescaleDB] Saved AI decision: " + decision.actual_state);
  } catch (err) {
    console.error("[TimescaleDB Error] Saving AI decision:", err.message);
  }
}

async function getRecentAiDecisions(limit = 25) {
  try {
    await ensureDecisionColumns();
    const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 200);
    const { rows } = await pool.query(
      `SELECT id, timestamp, rig_id, well_id, declared_op, actual_state, is_ilt, ilt_duration_seconds, confidence_score, justification
       FROM ai_decisions
       ORDER BY timestamp DESC
       LIMIT $1`,
      [safeLimit]
    );
    return rows;
  } catch (err) {
    console.error("[TimescaleDB Error] Fetching recent AI decisions:", err.message);
    return [];
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
      avg_confidence: 0
    };
  }
}

module.exports = {
  pool,
  saveTelemetryBatch,
  saveAiDecision,
  getRecentAiDecisions,
  getTelemetryStats
};
