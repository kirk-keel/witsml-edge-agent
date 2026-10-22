const { saveTelemetryBatch } = require("../services/db");
const express = require('express');
const { z } = require('zod');
const { analyzeRigStateAsync } = require('../services/ai');
const { telemetryIngestionCounter, telemetryPointsCounter } = require('../utils/metrics');
const { parseWitsmlXmlToTelemetry } = require('../utils/witsml-xml');
const { requireEdgeApiKey } = require('../utils/auth');

const router = express.Router();

const telemetrySchema = z.object({
    metadata: z.object({
        well_id: z.string(),
        rig_id: z.string(),
        window_start: z.string().datetime(),
        window_end: z.string().datetime(),
        interval_seconds: z.number().int().positive(),
        active_operation: z.string()
    }),
    telemetry: z.array(z.object({
        timestamp: z.string().datetime(),
        hole_depth_ft: z.number(),
        bit_depth_ft: z.number(),
        block_pos_ft: z.number(),
        hook_load_klbs: z.number(),
        wob_klbs: z.number(),
        spp_psi: z.number(),
        flow_in_gpm: z.number(),
        rpm: z.number(),
        flow_out_gpm: z.number().optional(),
        pit_gain_bbl: z.number().optional(),
        gas_units: z.number().optional(),
        ecd_ppg: z.number().optional()
    })).min(1)
});

async function ingestValidatedPayload(validatedData, res, sourceFormat = 'json') {
    const { rig_id, well_id, active_operation } = validatedData.metadata;
    console.log(`[Agent] Received ${sourceFormat.toUpperCase()} telemetry payload for ${rig_id} (${well_id})`);

    telemetryIngestionCounter.inc({
        rig_id,
        well_id,
        active_operation,
        status: 'accepted'
    });
    telemetryPointsCounter.inc(
        { rig_id, well_id },
        validatedData.telemetry.length
    );

    await saveTelemetryBatch(rig_id, well_id, validatedData);
    analyzeRigStateAsync(validatedData);

    return res.status(202).json({
        status: 'accepted',
        format: sourceFormat,
        message: 'Telemetry batch queued for AI analysis',
        well_id,
        rig_id,
        points_ingested: validatedData.telemetry.length
    });
}

async function handleTelemetryIngestion(req, res) {
    try {
        const validatedData = telemetrySchema.parse(req.body);
        return await ingestValidatedPayload(validatedData, res, 'json');
    } catch (error) {
        const rig_id = req.body?.metadata?.rig_id || 'unknown';
        const well_id = req.body?.metadata?.well_id || 'unknown';
        const active_operation = req.body?.metadata?.active_operation || 'unknown';

        if (error instanceof z.ZodError) {
            telemetryIngestionCounter.inc({ rig_id, well_id, active_operation, status: 'validation_error' });
            return res.status(400).json({ status: 'error', message: 'Invalid schema', issues: error.issues });
        }
        telemetryIngestionCounter.inc({ rig_id, well_id, active_operation, status: 'server_error' });
        return res.status(500).json({ status: 'error', message: 'Server error' });
    }
}

async function handleWitsmlXmlIngestion(req, res) {
    try {
        const xmlBody = typeof req.body === 'string' ? req.body : req.body?.xml || '';
        const parsedPayload = parseWitsmlXmlToTelemetry(xmlBody);
        const validatedData = telemetrySchema.parse(parsedPayload);
        return await ingestValidatedPayload(validatedData, res, 'witsml_xml');
    } catch (error) {
        telemetryIngestionCounter.inc({
            rig_id: 'unknown',
            well_id: 'unknown',
            active_operation: 'unknown',
            status: 'validation_error'
        });
        return res.status(400).json({
            status: 'error',
            message: error.message || 'Invalid WITSML XML payload'
        });
    }
}

router.post('/api/v1/telemetry', requireEdgeApiKey, handleTelemetryIngestion);
router.post('/api/witsml', requireEdgeApiKey, handleTelemetryIngestion);
router.post(
    '/api/v1/witsml/xml',
    requireEdgeApiKey,
    express.text({ type: ['application/xml', 'text/xml', 'text/plain'], limit: '2mb' }),
    handleWitsmlXmlIngestion
);

module.exports = { router, telemetrySchema };
