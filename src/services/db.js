const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST || "timescaledb",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "witsml_secure_pw",
  database: process.env.DB_NAME || "witsml_telemetry",
  port: 5432,
});

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

async function saveAiDecision(decision) {
  try {
    await pool.query(
      "INSERT INTO ai_decisions (actual_state, is_ilt, ilt_duration_seconds, confidence_score, justification) VALUES ($1, $2, $3, $4, $5)",
      [
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

module.exports = { saveTelemetryBatch, saveAiDecision };
