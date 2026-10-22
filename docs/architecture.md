# Architecture

## Purpose

The **WITSML Edge Agent** ingests high-frequency drilling rig sensor windows (WOB, RPM, Flow In, Standpipe Pressure, Hook Load, Bit/Hole Depth, Block Position), validates payload integrity at the edge, persists raw telemetry and AI decisions into TimescaleDB hypertables, and asynchronously evaluates rig operations against Standard Operating Procedures (SOPs) using a local Ollama LLM (`qwen2.5:1.5b`) to detect Invisible Lost Time (ILT).

## Data Flow

1. **Telemetry Ingestion (`POST /api/v1/telemetry` & `POST /api/witsml`):**
   - Incoming JSON payloads are validated synchronously against `telemetrySchema` (Zod) in `src/routes/telemetry.js`.
   - Invalid payloads return `400 Bad Request` immediately and increment `witsml_telemetry_batches_total{status="validation_error"}`.
   - Valid payloads increment `witsml_telemetry_batches_total{status="accepted"}` and `witsml_telemetry_points_total`, persist the raw JSONB window to the `telemetry_batches` hypertable in TimescaleDB, trigger asynchronous AI analysis (`analyzeRigStateAsync`), and return `202 Accepted` so rig telemetry producers are never blocked by LLM inference latency.

2. **Local LLM Evaluation (`src/services/ai.js`):**
   - Reads active SOP thresholds (`min_wob`, `min_rpm`, `min_flow`, `max_conn_time`) from memory/disk (`sop-config.json`).
   - Invokes local Ollama (`qwen2.5:1.5b`) with `temperature: 0` and Zod `StructuredOutputParser` to produce a deterministic engineering assessment (`actual_state`, `is_ilt`, `ilt_duration_seconds`, `confidence_score`, `justification`).
   - Records inference latency in the `witsml_ai_inference_duration_seconds` Prometheus histogram and increments `witsml_ai_decisions_total`, `witsml_ilt_detections_total`, and `witsml_ilt_duration_seconds_total`.

3. **Persistence & Real-Time Streaming (`src/services/db.js`, `src/utils/logger.js`, `src/index.js`):**
   - Persists each enriched assessment (`rig_id`, `well_id`, `declared_op`, `actual_state`, `is_ilt`, `ilt_duration_seconds`, `confidence_score`, `justification`) to the `ai_decisions` hypertable in TimescaleDB.
   - Appends an immutable audit entry to `logs/llm-audit.jsonl`.
   - Broadcasts the decision over Server-Sent Events (`GET /api/stream`) to connected web clients (`public/index.html`), which also hydrate historical decisions on load via `GET /api/decisions`.

4. **Observability (`Prometheus` + `Grafana`):**
   - Prometheus scrapes `http://witsml-agent:3000/metrics` every 15 seconds.
   - Grafana (`:3001`) connects to both `Prometheus` and `TimescaleDB` via declarative provisioning (`grafana/provisioning/`) and renders the **WITSML Edge AI & Rig Telemetry Overview** dashboard (`witsml-overview.json`).

## TimescaleDB Hypertables (`init.sql`)

- **`telemetry_batches`**: Partitioned on `timestamp TIMESTAMPTZ`, storing `rig_id`, `well_id`, and `payload JSONB`.
- **`ai_decisions`**: Partitioned on `timestamp TIMESTAMPTZ`, storing `rig_id`, `well_id`, `declared_op`, `actual_state`, `is_ilt`, `ilt_duration_seconds`, `confidence_score`, and `justification`.
