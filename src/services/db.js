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
    const query = `
      INSERT INTO telemetry_batches (rig_id, well_id, payload)
      VALUES ($1, $2, $3)
    `;
    await pool.query(query, [rigId, wellId, JSON.stringify(payload)]);
    console.log("Saved telemetry batch to TimescaleDB");
  } catch (err) {
    console.error("Error saving telemetry batch to TimescaleDB:", err.message);
  }
}

async function saveAiDecision(decision) {
  try {
    const query = `
      INSERT INTO ai_decisions (actual_state, is_ilt, ilt_duration_seconds, confidence_score, justification)
      VALUES ($1, $2, $3, $4, $5)
    `;
    await pool.query(query, [
      decision.actual_state,
      decision.is_ilt,
      decision.ilt_duration_seconds,
      decision.confidence_score,
      decision.justification
    ]);
    console.log("Saved AI decision to TimescaleDB");
  } catch (err) {
    console.error("Error saving AI decision to TimescaleDB:", err.message);
  }
}

module.exports = { saveTelemetryBatch, saveAiDecision };
