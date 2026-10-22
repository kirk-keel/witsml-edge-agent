/**
 * Rig-to-Cloud Batch Replicator
 * Syncs incremental AI decisions and telemetry KPIs from the rig edge node
 * to an optional corporate cloud endpoint (CLOUD_SYNC_URL) with checkpointing.
 */

let lastSyncedDecisionId = 0;
let lastSyncAt = null;
let totalSyncedRecords = 0;
let lastStatus = process.env.CLOUD_SYNC_URL ? 'idle' : 'disabled';
let lastError = null;

async function triggerCloudSync(fetchRecentDecisionsFn) {
    const cloudUrl = process.env.CLOUD_SYNC_URL;
    const decisions = typeof fetchRecentDecisionsFn === 'function'
        ? await fetchRecentDecisionsFn({ limit: 100 })
        : [];

    const unsynced = decisions
        .filter((d) => Number(d.id || 0) > lastSyncedDecisionId)
        .sort((a, b) => Number(a.id) - Number(b.id));

    if (!cloudUrl) {
        lastStatus = 'local_checkpoint_only';
        if (unsynced.length > 0) {
            lastSyncedDecisionId = Number(unsynced[unsynced.length - 1].id);
            totalSyncedRecords += unsynced.length;
            lastSyncAt = new Date().toISOString();
        }
        return {
            status: lastStatus,
            records_synced: unsynced.length,
            last_synced_decision_id: lastSyncedDecisionId,
            last_sync_at: lastSyncAt
        };
    }

    try {
        const res = await fetch(cloudUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(process.env.EDGE_API_KEY ? { 'X-Edge-Key': process.env.EDGE_API_KEY } : {})
            },
            body: JSON.stringify({
                source: 'witsml-edge-agent',
                synced_at: new Date().toISOString(),
                records: unsynced
            }),
            signal: AbortSignal.timeout(5000)
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }

        if (unsynced.length > 0) {
            lastSyncedDecisionId = Number(unsynced[unsynced.length - 1].id);
            totalSyncedRecords += unsynced.length;
        }
        lastSyncAt = new Date().toISOString();
        lastStatus = 'synced';
        lastError = null;

        return {
            status: lastStatus,
            records_synced: unsynced.length,
            last_synced_decision_id: lastSyncedDecisionId,
            last_sync_at: lastSyncAt
        };
    } catch (err) {
        lastStatus = 'error';
        lastError = err.message;
        return {
            status: lastStatus,
            records_synced: 0,
            last_synced_decision_id: lastSyncedDecisionId,
            last_sync_at: lastSyncAt,
            error: lastError
        };
    }
}

function getCloudSyncStatus() {
    return {
        enabled: Boolean(process.env.CLOUD_SYNC_URL),
        status: process.env.CLOUD_SYNC_URL ? lastStatus : (lastSyncAt ? lastStatus : 'disabled'),
        last_synced_decision_id: lastSyncedDecisionId,
        total_synced_records: totalSyncedRecords,
        last_sync_at: lastSyncAt,
        ...(lastError ? { last_error: lastError } : {})
    };
}

module.exports = {
    triggerCloudSync,
    getCloudSyncStatus
};
