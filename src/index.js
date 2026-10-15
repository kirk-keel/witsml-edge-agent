require('dotenv').config();
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Health check endpoint for container orchestration
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', service: 'witsml-agent' });
});

// Placeholder for the streaming telemetry ingestion
app.post('/api/v1/telemetry', (req, res) => {
    res.status(202).json({ message: 'Telemetry batch received for analysis' });
});

app.listen(PORT, () => {
    console.log([System] WITSML Agent running on port $PORT);
});
