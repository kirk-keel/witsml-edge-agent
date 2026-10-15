require('dotenv').config();
const express = require('express');
const telemetryRoutes = require('./routes/telemetry');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', service: 'witsml-agent' });
});

// Connect the new validation and AI pipeline
app.use('/', telemetryRoutes);

app.listen(PORT, () => {
    console.log(`[System] WITSML Agent running on port ${PORT}`);
});
