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
    schemaChecked = true;
  } catch (err) {
    console.warn("[TimescaleDB] Could not verify ai_decisions columns:", err.message);
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

module.exports = { pool, saveTelemetryBatch, saveAiDecision, getRecentAiDecisions };
