const express = require('express');
const { z } = require('zod');
const { analyzeRigStateAsync } = require('../services/ai');

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
        rpm: z.number()
    })).min(1)
});

router.post('/api/v1/telemetry', async (req, res) => {
    try {
        const validatedData = telemetrySchema.parse(req.body);
        analyzeRigStateAsync(validatedData);

        return res.status(202).json({ 
            status: 'accepted', 
            message: 'Telemetry batch queued for AI analysis',
            well_id: validatedData.metadata.well_id
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ status: 'error', message: 'Invalid schema', issues: error.issues });
        }
        return res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

module.exports = router;
