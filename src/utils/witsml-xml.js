/**
 * WITSML v1.4.1.1 / v2.0 XML <log> parser that converts standard WITSML mnemonics
 * (TIME, DEPT, DBTM, BPOS, HKLD, WOB, SPPA, MFIA, RPM) into the canonical JSON schema.
 */

const MNEMONIC_MAP = Object.freeze({
    TIME: 'timestamp',
    TIMESTAMP: 'timestamp',
    DTIME: 'timestamp',
    DEPT: 'hole_depth_ft',
    HDTH: 'hole_depth_ft',
    HOLE_DEPTH: 'hole_depth_ft',
    HOLE_DEPTH_FT: 'hole_depth_ft',
    DBTM: 'bit_depth_ft',
    BDTH: 'bit_depth_ft',
    BIT_DEPTH: 'bit_depth_ft',
    BIT_DEPTH_FT: 'bit_depth_ft',
    BPOS: 'block_pos_ft',
    BLKPOS: 'block_pos_ft',
    BLOCK_POS: 'block_pos_ft',
    BLOCK_POS_FT: 'block_pos_ft',
    HKLD: 'hook_load_klbs',
    HKLA: 'hook_load_klbs',
    HOOK_LOAD: 'hook_load_klbs',
    HOOK_LOAD_KLBS: 'hook_load_klbs',
    WOB: 'wob_klbs',
    SWOB: 'wob_klbs',
    WOB_KLBS: 'wob_klbs',
    SPPA: 'spp_psi',
    SPP: 'spp_psi',
    SPP_PSI: 'spp_psi',
    MFIA: 'flow_in_gpm',
    FLOWIN: 'flow_in_gpm',
    TFLO: 'flow_in_gpm',
    FLOW_IN_GPM: 'flow_in_gpm',
    MFOA: 'flow_out_gpm',
    FLOWOUT: 'flow_out_gpm',
    FLOW_OUT_GPM: 'flow_out_gpm',
    TVCA: 'pit_gain_bbl',
    PITGAIN: 'pit_gain_bbl',
    PIT_GAIN_BBL: 'pit_gain_bbl',
    GASA: 'gas_units',
    GAS: 'gas_units',
    GAS_UNITS: 'gas_units',
    ECDA: 'ecd_ppg',
    ECD: 'ecd_ppg',
    ECD_PPG: 'ecd_ppg',
    RPM: 'rpm',
    SRPM: 'rpm'
});

function extractTagText(xml, tagName) {
    const regex = new RegExp(`<(?:\\w+:)?${tagName}[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tagName}>`, 'i');
    const match = xml.match(regex);
    return match ? match[1].trim() : null;
}

function extractAttr(xml, tagName, attrName) {
    const regex = new RegExp(`<(?:\\w+:)?${tagName}[^>]*\\b${attrName}=["']([^"']+)["'][^>]*>`, 'i');
    const match = xml.match(regex);
    return match ? match[1].trim() : null;
}

function parseWitsmlXmlToTelemetry(xmlString) {
    if (typeof xmlString !== 'string' || !xmlString.trim().startsWith('<')) {
        throw new Error('Invalid WITSML XML payload');
    }

    const wellId =
        extractTagText(xmlString, 'nameWell') ||
        extractAttr(xmlString, 'log', 'uidWell') ||
        'WL-XML-01';

    const rigId =
        extractTagText(xmlString, 'nameWellbore') ||
        extractTagText(xmlString, 'rig') ||
        extractAttr(xmlString, 'log', 'uidWellbore') ||
        'Rig-412';

    const activeOperation = (
        extractTagText(xmlString, 'activeOperation') ||
        extractTagText(xmlString, 'operation') ||
        extractAttr(xmlString, 'log', 'activeOperation') ||
        'drilling'
    ).toLowerCase();

    const intervalSeconds = Number(extractTagText(xmlString, 'intervalSeconds')) || 10;

    // Extract mnemonics from <mnemonicList> or <logCurveInfo><mnemonic>
    let mnemonics = [];
    const mnemonicListRaw = extractTagText(xmlString, 'mnemonicList');
    if (mnemonicListRaw) {
        mnemonics = mnemonicListRaw.split(/[,\s]+/).map(m => m.trim().toUpperCase()).filter(Boolean);
    } else {
        const curveRegex = /<(?:\w+:)?logCurveInfo[\s\S]*?<(?:\w+:)?mnemonic[^>]*>([\s\S]*?)<\/(?:\w+:)?mnemonic>[\s\S]*?<\/(?:\w+:)?logCurveInfo>/gi;
        let match;
        while ((match = curveRegex.exec(xmlString)) !== null) {
            mnemonics.push(match[1].trim().toUpperCase());
        }
    }

    if (mnemonics.length === 0) {
        throw new Error('WITSML XML missing <mnemonicList> or <logCurveInfo> definitions');
    }

    // Extract all <data>...</data> rows
    const dataRegex = /<(?:\w+:)?data[^>]*>([\s\S]*?)<\/(?:\w+:)?data>/gi;
    const telemetry = [];
    let dataMatch;
    while ((dataMatch = dataRegex.exec(xmlString)) !== null) {
        const rowText = dataMatch[1].trim();
        if (!rowText) continue;
        const values = rowText.split(',').map(v => v.trim());
        const point = {
            timestamp: new Date().toISOString(),
            hole_depth_ft: 0,
            bit_depth_ft: 0,
            block_pos_ft: 0,
            hook_load_klbs: 0,
            wob_klbs: 0,
            spp_psi: 0,
            flow_in_gpm: 0,
            rpm: 0
        };

        mnemonics.forEach((mnemonic, idx) => {
            const targetKey = MNEMONIC_MAP[mnemonic];
            if (!targetKey || values[idx] === undefined || values[idx] === '') return;
            if (targetKey === 'timestamp') {
                const parsedDate = new Date(values[idx]);
                point.timestamp = Number.isNaN(parsedDate.getTime())
                    ? new Date().toISOString()
                    : parsedDate.toISOString();
            } else {
                const numVal = Number(values[idx]);
                if (Number.isFinite(numVal)) {
                    point[targetKey] = numVal;
                }
            }
        });

        telemetry.push(point);
    }

    if (telemetry.length === 0) {
        throw new Error('WITSML XML contains no <data> telemetry rows');
    }

    const timestamps = telemetry.map(t => Date.parse(t.timestamp)).filter(Number.isFinite);
    const minTime = timestamps.length > 0 ? Math.min(...timestamps) : Date.now();
    const maxTime = timestamps.length > 0 ? Math.max(...timestamps) : minTime + 300000;
    const windowStart = extractTagText(xmlString, 'startDateTimeIndex') || new Date(minTime).toISOString();
    const windowEnd = extractTagText(xmlString, 'endDateTimeIndex') ||
        new Date(maxTime > minTime ? maxTime : minTime + 300000).toISOString();

    return {
        metadata: {
            well_id: wellId,
            rig_id: rigId,
            window_start: new Date(windowStart).toISOString(),
            window_end: new Date(windowEnd).toISOString(),
            interval_seconds: intervalSeconds,
            active_operation: activeOperation
        },
        telemetry
    };
}

module.exports = { parseWitsmlXmlToTelemetry };
