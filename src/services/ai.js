const fs = require("fs");
const { saveAiDecision } = require("./db");
const EventEmitter = require("events");

class TelemetryEventEmitter extends EventEmitter {}
const telemetryEvents = new TelemetryEventEmitter();

telemetryEvents.on("assessment", async (result) => {
  const logDir = "/usr/src/app/logs";
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(logDir + "/ai-decisions.log", JSON.stringify(result) + "\\n");
  
  await saveAiDecision(result);
});

module.exports = { telemetryEvents };
