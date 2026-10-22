/**
 * Early Kick & Lost Circulation Well Control Diagnostics Engine
 * Evaluates differential flow (Flow Out - Flow In), active pit gain/loss (bbl),
 * connection flow-shows, gas units, and Equivalent Circulating Density (ECD).
 */

function evaluateWellControl(data) {
    const points = Array.isArray(data)
        ? data
        : Array.isArray(data?.telemetry) && data.telemetry.length > 0
          ? data.telemetry
          : [];
    const count = Math.max(points.length, 1);

    const avg = (fn) => points.reduce((sum, pt) => sum + fn(pt), 0) / count;

    const avgFlowIn = Number(avg((p) => Number(p.flow_in_gpm || 0)).toFixed(2));
    const hasExplicitFlowOut = points.some((p) => p.flow_out_gpm !== undefined && p.flow_out_gpm !== null);
    const avgFlowOut = hasExplicitFlowOut
        ? Number(avg((p) => Number(p.flow_out_gpm ?? p.flow_in_gpm ?? 0)).toFixed(2))
        : avgFlowIn;

    const differentialFlowGpm = Number((avgFlowOut - avgFlowIn).toFixed(2));
    const avgPitGainBbl = Number(avg((p) => Number(p.pit_gain_bbl || 0)).toFixed(2));
    const maxGasUnits = points.reduce((max, p) => Math.max(max, Number(p.gas_units || 0)), 0);
    const avgEcdPpg = Number(avg((p) => Number(p.ecd_ppg || 0)).toFixed(2));
    const avgSppPsi = Number(avg((p) => Number(p.spp_psi || 0)).toFixed(2));

    let status = 'normal';
    let severity = 'normal';
    const reasons = [];

    // 1. Primary Well Control: Influx / Kick Detection
    const pumpsOffFlowShow = avgFlowIn < 10 && hasExplicitFlowOut && avgFlowOut >= 15;
    if (differentialFlowGpm >= 25 || avgPitGainBbl >= 5 || pumpsOffFlowShow || (maxGasUnits >= 500 && differentialFlowGpm >= 10)) {
        status = 'kick_warning';
        severity = 'critical';
        if (pumpsOffFlowShow) {
            reasons.push(`Flow-show with pumps off (Flow Out ${avgFlowOut} GPM vs Flow In ${avgFlowIn} GPM)`);
        }
        if (differentialFlowGpm >= 25) {
            reasons.push(`Positive differential flow +${differentialFlowGpm} GPM (Out ${avgFlowOut} vs In ${avgFlowIn})`);
        }
        if (avgPitGainBbl >= 5) {
            reasons.push(`Active pit volume gain +${avgPitGainBbl} bbl`);
        }
        if (maxGasUnits >= 500) {
            reasons.push(`Elevated gas reading ${maxGasUnits} units`);
        }
    }
    // 2. Lost Circulation Detection
    else if ((hasExplicitFlowOut && differentialFlowGpm <= -25) || avgPitGainBbl <= -5) {
        status = 'lost_circulation';
        severity = 'critical';
        if (hasExplicitFlowOut && differentialFlowGpm <= -25) {
            reasons.push(`Negative differential flow ${differentialFlowGpm} GPM (Out ${avgFlowOut} vs In ${avgFlowIn})`);
        }
        if (avgPitGainBbl <= -5) {
            reasons.push(`Active pit volume loss ${avgPitGainBbl} bbl`);
        }
    }
    // 3. Hydraulic Packoff / High ECD Warning
    else if (avgSppPsi > 3800 || avgEcdPpg >= 16.5) {
        status = 'packoff_risk';
        severity = 'warning';
        if (avgSppPsi > 3800) reasons.push(`High standpipe pressure ${avgSppPsi} psi`);
        if (avgEcdPpg >= 16.5) reasons.push(`Elevated ECD ${avgEcdPpg} ppg`);
    }
    // 4. Drillstring Washout Risk
    else if (avgFlowIn >= 300 && avgSppPsi > 0 && avgSppPsi < 1400) {
        status = 'washout_risk';
        severity = 'warning';
        reasons.push(`Low standpipe pressure ${avgSppPsi} psi at ${avgFlowIn} GPM flow`);
    }

    return {
        well_control_status: status,
        severity,
        is_well_control_event: status === 'kick_warning' || status === 'lost_circulation',
        differential_flow_gpm: differentialFlowGpm,
        avg_flow_in_gpm: avgFlowIn,
        avg_flow_out_gpm: avgFlowOut,
        pit_gain_bbl: avgPitGainBbl,
        max_gas_units: maxGasUnits,
        avg_ecd_ppg: avgEcdPpg,
        diagnostic_summary: reasons.length > 0 ? reasons.join('; ') : 'Wellbore returns and pit volume balanced.'
    };
}

module.exports = { evaluateWellControl };
