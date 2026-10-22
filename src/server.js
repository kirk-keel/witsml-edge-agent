const express = require("express");
const telemetryRoutes = require("./routes/telemetry");

const app = express();
app.use(express.json());

// Support both /api/telemetry and /api/v1/telemetry
app.use("/api/telemetry", telemetryRoutes);
app.use("/api/v1/telemetry", telemetryRoutes);

app.get("/", (req, res) => {
  res.status(200).json({ status: "active", service: "WITSML Edge Agent" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`WITSML Edge Agent running on port ${PORT}`);
});
