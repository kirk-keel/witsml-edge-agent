const fs = require('fs');
const path = require('path');
const { edgeSpoolPendingGauge } = require('./metrics');

const spoolDir = path.join(__dirname, '../../logs');
const spoolFilePath = path.join(spoolDir, 'edge-spool.jsonl');

let spoolQueue = [];
let isFlushing = false;

function loadSpoolFromDisk() {
    try {
        if (!fs.existsSync(spoolFilePath)) {
            spoolQueue = [];
            edgeSpoolPendingGauge.set(0);
            return;
        }
        const raw = fs.readFileSync(spoolFilePath, 'utf8');
        spoolQueue = raw
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
                try {
                    return JSON.parse(line);
                } catch {
                    return null;
                }
            })
            .filter(Boolean);
        edgeSpoolPendingGauge.set(spoolQueue.length);
    } catch (err) {
        spoolQueue = [];
        edgeSpoolPendingGauge.set(0);
    }
}

function persistSpoolToDisk() {
    try {
        if (!fs.existsSync(spoolDir)) {
            fs.mkdirSync(spoolDir, { recursive: true });
        }
        if (spoolQueue.length === 0) {
            if (fs.existsSync(spoolFilePath)) {
                fs.unlinkSync(spoolFilePath);
            }
        } else {
            const payload = spoolQueue.map((item) => JSON.stringify(item)).join('\n') + '\n';
            fs.writeFileSync(spoolFilePath, payload, 'utf8');
        }
    } catch (err) {
        console.warn('[Edge Spooler] Disk persistence warning:', err.message);
    }
    edgeSpoolPendingGauge.set(spoolQueue.length);
}

loadSpoolFromDisk();

function enqueueSpoolRecord(type, data) {
    const entry = {
        type,
        spooled_at: new Date().toISOString(),
        data
    };
    spoolQueue.push(entry);
    // Cap spool at 1000 records to bound edge disk usage
    if (spoolQueue.length > 1000) {
        spoolQueue.shift();
    }
    persistSpoolToDisk();
    return entry;
}

async function flushSpool(handlers) {
    if (isFlushing || spoolQueue.length === 0) {
        return { flushed: 0, remaining: spoolQueue.length };
    }
    isFlushing = true;
    let flushed = 0;
    const remaining = [];

    try {
        for (const item of spoolQueue) {
            try {
                if (item.type === 'batch' && handlers?.onBatch) {
                    await handlers.onBatch(item.data);
                    flushed++;
                } else if (item.type === 'decision' && handlers?.onDecision) {
                    await handlers.onDecision(item.data);
                    flushed++;
                }
            } catch (err) {
                remaining.push(item);
            }
        }
        spoolQueue = remaining;
        persistSpoolToDisk();
    } finally {
        isFlushing = false;
    }

    return { flushed, remaining: spoolQueue.length };
}

function clearSpool() {
    spoolQueue = [];
    persistSpoolToDisk();
}

function getSpoolStatus() {
    return {
        pending_count: spoolQueue.length,
        spool_file: 'logs/edge-spool.jsonl'
    };
}

module.exports = {
    enqueueSpoolRecord,
    flushSpool,
    clearSpool,
    getSpoolStatus
};
