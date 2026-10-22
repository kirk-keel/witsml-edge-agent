const express = require("express");
const router = express.Router();
const { telemetryEvents } = require("../services/ai");
const { saveTelemetryBatch } = require("../services/db");

router.post("/", async (req, res) => {
  try {
    const { well_id, rig_id, telemetry } = req.body;
    
    await saveTelemetryBatch(rig_id || "Rig-412", well_id || "WL-9924", telemetry || req.body);

    res.status(202).json({
      status: "accepted",
      message: "Telemetry batch queued for AI analysis",
      well_id: well_id || "WL-9924",
      rig_id: rig_id || "Rig-412"
    });

    setTimeout(() => {
      const sampleDecision = {
        actual_state: telemetry?.operational_state || "drilling",
        is_ilt: true,
        ilt_duration_seconds: 180,
        confidence_score: 0.95,
        justification: "Simulated high-confidence operational assessment."
      };
      telemetryEvents.emit("assessment", sampleDecision);
    }, 1000);

  } catch (err) {
    console.error("Error processing telemetry route:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
