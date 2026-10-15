const fs = require('fs');
const path = require('path');

const logDirectory = path.join(__dirname, '../../logs');
if (!fs.existsSync(logDirectory)) {
    fs.mkdirSync(logDirectory);
}

const auditLogPath = path.join(logDirectory, 'llm-audit.jsonl');

function logAiDecision(metadata, promptTokens, aiResponse) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        well_id: metadata.well_id,
        rig_id: metadata.rig_id,
        window_start: metadata.window_start,
        model_used: process.env.OPENAI_MODEL_NAME || 'unknown',
        token_usage: promptTokens,
        decision: aiResponse,
    };

    fs.appendFile(auditLogPath, JSON.stringify(logEntry) + '\n', (err) => {
        if (err) console.error('[Logger Error] Failed to write log', err);
    });
}

module.exports = { logAiDecision };
