/**
 * Predictive Bit Wear, Stick-Slip Vibration & Tripping Swab/Surge Engine
 * Computes:
 *  - Stick-Slip Severity Index (SSI) from RPM and surface torque (TQA) oscillations
 *  - Bit Wear Index (0-100%) and IADC Dull Grade (T0-T8) from MSE efficiency degradation
 *  - Tripping Pipe Velocity (ft/min) and Swab/Surge well-control risk
 */

const baselineMseByRig = new Map();
const DEFAULT_BASELINE_MSE_PSI = 18000;

function evaluateBitAndVibration(data, mechanics = {}, sopConfig = {}) {
    const points = Array.isArray(data)
        ? data
        : Array.isArray(data?.telemetry) && data.telemetry.length > 0
          ? data.telemetry
          : [];
    const count = Math.max(points.length, 1);
    const rigId = data?.metadata?.rig_id || 'Rig-412';
    const declaredOp = String(data?.metadata?.active_operation || 'drilling').toLowerCase();

    // 1. Stick-Slip Severity Index (SSI = (RPM_max - RPM_min) / (2 * RPM_avg))
    const rpms = points.map((p) => Number(p.rpm || 0)).filter((v) => v > 0);
    const torques = points.map((p) => Number(p.torque_klbft || 0)).filter((v) => v > 0);

    let stickSlipIndex = 0;
    if (rpms.length >= 2) {
        const minRpm = Math.min(...rpms);
        const maxRpm = Math.max(...rpms);
        const avgRpm = rpms.reduce((a, b) => a + b, 0) / rpms.length;
        if (avgRpm > 5) {
            stickSlipIndex = Number(((maxRpm - minRpm) / (2 * avgRpm)).toFixed(2));
        }
    }
    if (torques.length >= 2) {
        const minTq = Math.min(...torques);
        const maxTq = Math.max(...torques);
        const avgTq = torques.reduce((a, b) => a + b, 0) / torques.length;
        if (avgTq > 0.5) {
            const tqSsi = Number(((maxTq - minTq) / (2 * avgTq)).toFixed(2));
            stickSlipIndex = Math.max(stickSlipIndex, tqSsi);
        }
    }

    let vibrationStatus = 'smooth';
    if (stickSlipIndex >= 0.8) {
        vibrationStatus = 'severe_stick_slip';
    } else if (stickSlipIndex >= 0.45) {
        vibrationStatus = 'moderate_stick_slip';
    }

    // 2. Predictive Bit Wear (0 - 100%) and IADC Dull Grade (T0 - T8)
    const currentMse = Number(mechanics?.mse_psi || 0);
    let baselineMse = baselineMseByRig.get(rigId) || DEFAULT_BASELINE_MSE_PSI;
    if (currentMse > 5000 && currentMse < baselineMse) {
        baselineMse = currentMse;
        baselineMseByRig.set(rigId, baselineMse);
    }

    let bitWearPct = 0;
    if (currentMse > baselineMse) {
        // Every +45,000 psi above baseline approaches 100% cutter wear
        const rawWear = ((currentMse - baselineMse) / 45000) * 100 + stickSlipIndex * 15;
        bitWearPct = Number(Math.min(100, Math.max(0, rawWear)).toFixed(1));
    } else if (currentMse > 0) {
        bitWearPct = Number(Math.min(100, Math.max(0, (currentMse / (baselineMse * 3)) * 100)).toFixed(1));
    }

    const iadcStep = Math.min(8, Math.max(0, Math.round((bitWearPct / 100) * 8)));
    const bitGrade = `T${iadcStep}`;
    let bitRecommendation = 'normal';
    if (bitWearPct >= 75) {
        bitRecommendation = 'pull_bit_recommended';
    } else if (bitWearPct >= 45) {
        bitRecommendation = 'monitor_cutters';
    }

    // 3. Tripping Speed (ft/min) & Swab/Surge Envelope
    let trippingSpeedFpm = 0;
    if (points.length >= 2) {
        const first = points[0];
        const last = points[points.length - 1];
        const deltaBitDepth = Math.abs(Number(last.bit_depth_ft ?? 0) - Number(first.bit_depth_ft ?? 0));
        const deltaBlock = Math.abs(Number(last.block_pos_ft ?? 0) - Number(first.block_pos_ft ?? 0));
        const distanceFt = Math.max(deltaBitDepth, deltaBlock);

        const tStart = Date.parse(first.timestamp);
        const tEnd = Date.parse(last.timestamp);
        const spanMinutes = Number.isFinite(tStart) && Number.isFinite(tEnd) && tEnd > tStart
            ? (tEnd - tStart) / 60000
            : ((count - 1) * (Number(data?.metadata?.interval_seconds) || 10)) / 60;

        if (spanMinutes > 0 && distanceFt > 0) {
            trippingSpeedFpm = Number((distanceFt / spanMinutes).toFixed(1));
        }
    }

    const maxTripSpeedFpm = Number(sopConfig?.max_trip_speed_fpm) > 0 ? Number(sopConfig.max_trip_speed_fpm) : 90;
    let swabSurgeStatus = 'normal';
    if (trippingSpeedFpm > maxTripSpeedFpm) {
        if (declaredOp.includes('out')) {
            swabSurgeStatus = 'swab_risk';
        } else if (declaredOp.includes('in') || declaredOp.includes('trip')) {
            swabSurgeStatus = 'surge_risk';
        }
    }

    return {
        stick_slip_index: stickSlipIndex,
        vibration_status: vibrationStatus,
        bit_wear_pct: bitWearPct,
        bit_grade: bitGrade,
        bit_recommendation: bitRecommendation,
        tripping_speed_fpm: trippingSpeedFpm,
        swab_surge_status: swabSurgeStatus
    };
}

function resetBitWearBaselines() {
    baselineMseByRig.clear();
}

module.exports = { evaluateBitAndVibration, resetBitWearBaselines };
