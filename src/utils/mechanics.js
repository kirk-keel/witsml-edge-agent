/**
 * Drilling Mechanics & Well Control Physics Engine
 * Computes Rate of Penetration (ROP, ft/hr), Teale's Mechanical Specific Energy (MSE, psi),
 * Standpipe Pressure (SPP) hydraulic health, and ILT financial cost ($ USD).
 */

const BIT_DIAMETER_IN = 8.5;
const BIT_AREA_SQIN = Math.PI * Math.pow(BIT_DIAMETER_IN / 2, 2); // ~56.745 sq.in
const BIT_FRICTION_COEFF = 0.35;

function computeDrillingMechanics(data, sopConfig = {}, iltDurationSeconds = 0) {
    const points = Array.isArray(data)
        ? data
        : Array.isArray(data?.telemetry) && data.telemetry.length > 0
          ? data.telemetry
          : [];
    const count = Math.max(points.length, 1);

    const avg = (key) => points.reduce((sum, pt) => sum + Number(pt[key] || 0), 0) / count;
    const avgWobKlbs = Number(avg('wob_klbs').toFixed(2));
    const avgRpm = Number(avg('rpm').toFixed(2));
    const avgFlowGpm = Number(avg('flow_in_gpm').toFixed(2));
    const avgSppPsi = Number(avg('spp_psi').toFixed(2));
    const avgHookLoadKlbs = Number(avg('hook_load_klbs').toFixed(2));

    // Calculate ROP (ft/hr) from depth progression if multi-point delta > 0, else empirical bit model
    let ropFphr = 0;
    if (points.length >= 2) {
        const first = points[0];
        const last = points[points.length - 1];
        const deltaDepthFt = Number(last.hole_depth_ft || 0) - Number(first.hole_depth_ft || 0);
        const deltaHours = (Date.parse(last.timestamp) - Date.parse(first.timestamp)) / 3600000;
        if (deltaDepthFt > 0 && Number.isFinite(deltaHours) && deltaHours > 0) {
            ropFphr = Number((deltaDepthFt / deltaHours).toFixed(2));
        }
    }

    if (ropFphr === 0 && avgWobKlbs > 0.5 && avgRpm > 5) {
        // Empirical Bourgoyne-Young / Maurer drilling rate approximation for 8.5" PDC bit
        const wobPerInch = avgWobKlbs / BIT_DIAMETER_IN;
        ropFphr = Number((22.5 * Math.pow(wobPerInch, 1.05) * Math.pow(avgRpm / 100, 0.85)).toFixed(2));
    }

    // Teale (1965) Mechanical Specific Energy (MSE, psi)
    let msePsi = 0;
    if (ropFphr > 0 && avgWobKlbs > 0 && avgRpm > 0) {
        const wobLbs = avgWobKlbs * 1000;
        const torqueFtLbs = (BIT_FRICTION_COEFF * BIT_DIAMETER_IN * wobLbs) / 36;
        const axialTerm = wobLbs / BIT_AREA_SQIN;
        const rotaryTerm = (120 * Math.PI * avgRpm * torqueFtLbs) / (BIT_AREA_SQIN * ropFphr);
        msePsi = Math.round(axialTerm + rotaryTerm);
    }

    // Hydraulic anomaly check (SPP vs Flow)
    let hydraulicStatus = 'normal';
    if (avgFlowGpm >= 300 && avgSppPsi > 0 && avgSppPsi < 1400) {
        hydraulicStatus = 'washout_risk';
    } else if (avgSppPsi > 3800) {
        hydraulicStatus = 'packoff_risk';
    }

    // Financial cost of ILT ($ USD) based on rig daily spread rate
    const dayRateUsd = Number(sopConfig?.rig_day_rate_usd) > 0 ? Number(sopConfig.rig_day_rate_usd) : 72000;
    const costPerSecond = dayRateUsd / 86400;
    const iltCostUsd = Number((Math.max(0, Number(iltDurationSeconds) || 0) * costPerSecond).toFixed(2));

    return {
        rop_fphr: ropFphr,
        mse_psi: msePsi,
        mse_ksi: Number((msePsi / 1000).toFixed(2)),
        hydraulic_status: hydraulicStatus,
        ilt_cost_usd: iltCostUsd,
        rig_day_rate_usd: dayRateUsd,
        avg_spp_psi: avgSppPsi,
        avg_hook_load_klbs: avgHookLoadKlbs
    };
}

module.exports = { computeDrillingMechanics };
