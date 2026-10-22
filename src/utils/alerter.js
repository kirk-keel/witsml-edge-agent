const { alertWebhooksCounter } = require('./metrics');

const recentAlerts = [];
const MAX_RECENT_ALERTS = 50;

function getRecentAlerts(limit = 20) {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), MAX_RECENT_ALERTS);
    return recentAlerts.slice(0, safeLimit);
}

async function dispatchIltAlert(decision) {
    if (!decision) return null;

    const isWellControl = Boolean(decision.well_control?.is_well_control_event) ||
        decision.hydraulic_status === 'kick_warning' ||
        decision.hydraulic_status === 'lost_circulation';

    const minSeconds = Number(process.env.ALERT_MIN_ILT_SECONDS) || 60;
    const duration = Number(decision.ilt_duration_seconds) || 0;
    if (!isWellControl && (!decision.is_ilt || duration < minSeconds)) return null;

    const alertEvent = {
        event: isWellControl ? 'well_control_incident' : 'ilt_detected',
        severity: isWellControl || duration >= 180 ? 'critical' : 'warning',
        rig_id: decision.rig_id || 'unknown',
        well_id: decision.well_id || 'unknown',
        declared_op: decision.declared_op || 'unknown',
        actual_state: decision.actual_state || 'unknown',
        hydraulic_status: decision.hydraulic_status || 'normal',
        ilt_duration_seconds: duration,
        ilt_cost_usd: Number(decision.ilt_cost_usd) || 0,
        confidence_score: decision.confidence_score,
        justification: decision.well_control?.diagnostic_summary && isWellControl
            ? `${decision.justification} | Well Control: ${decision.well_control.diagnostic_summary}`
            : decision.justification,
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
