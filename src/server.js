const express = require("express");
const telemetryRoutes = require("./routes/telemetry");

const app = express();
app.use(express.json());

app.use("/api/telemetry", telemetryRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`WITSML Edge Agent running on port ${PORT}`);
});
