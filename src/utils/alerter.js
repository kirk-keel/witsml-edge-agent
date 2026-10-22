const { alertWebhooksCounter } = require('./metrics');

const recentAlerts = [];
const MAX_RECENT_ALERTS = 50;

function getRecentAlerts(limit = 20) {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), MAX_RECENT_ALERTS);
    return recentAlerts.slice(0, safeLimit);
}

async function dispatchIltAlert(decision) {
    if (!decision || !decision.is_ilt) return null;

    const minSeconds = Number(process.env.ALERT_MIN_ILT_SECONDS) || 60;
    const duration = Number(decision.ilt_duration_seconds) || 0;
    if (duration < minSeconds) return null;

    const alertEvent = {
        event: 'ilt_detected',
        severity: duration >= 180 ? 'critical' : 'warning',
        rig_id: decision.rig_id || 'unknown',
        well_id: decision.well_id || 'unknown',
        declared_op: decision.declared_op || 'unknown',
        actual_state: decision.actual_state || 'unknown',
        ilt_duration_seconds: duration,
        confidence_score: decision.confidence_score,
        justification: decision.justification,
        timestamp: decision.timestamp || new Date().toISOString(),
        webhook_dispatched: false
    };

    const webhookUrl = process.env.ALERT_WEBHOOK_URL;
    if (webhookUrl) {
        try {
            const res = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: `[WITSML ILT Alert] Rig ${alertEvent.rig_id} (${alertEvent.well_id}) - ${alertEvent.actual_state} (${duration}s ILT): ${alertEvent.justification}`,
                    ...alertEvent
                }),
                signal: AbortSignal.timeout(4000)
            });
            alertEvent.webhook_dispatched = res.ok;
            alertWebhooksCounter.inc({
                rig_id: alertEvent.rig_id,
                severity: alertEvent.severity,
                status: res.ok ? 'sent' : 'http_error'
            });
        } catch (err) {
            alertWebhooksCounter.inc({
                rig_id: alertEvent.rig_id,
                severity: alertEvent.severity,
                status: 'network_error'
            });
        }
    } else {
        alertWebhooksCounter.inc({
            rig_id: alertEvent.rig_id,
            severity: alertEvent.severity,
            status: 'logged_local'
        });
    }

    recentAlerts.unshift(alertEvent);
    if (recentAlerts.length > MAX_RECENT_ALERTS) {
        recentAlerts.pop();
    }

    return alertEvent;
}

module.exports = { dispatchIltAlert, getRecentAlerts };
