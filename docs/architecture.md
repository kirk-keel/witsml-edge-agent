# Architecture

## Purpose

The **WITSML Edge Agent** ingests high-frequency drilling rig sensor windows (WOB, RPM, Flow In, Standpipe Pressure, Hook Load, Bit/Hole Depth, Block Position), validates payload integrity at the edge, persists raw telemetry and AI decisions into TimescaleDB hypertables, and asynchronously evaluates rig operations against Standard Operating Procedures (SOPs) using a hybrid deterministic + local Ollama LLM (`qwen2.5:1.5b`) pipeline to detect Invisible Lost Time (ILT).

## Data Flow

1. **Telemetry Ingestion (`POST /api/v1/telemetry` & `POST /api/witsml`):**
   - Incoming JSON payloads are validated synchronously against `telemetrySchema` (Zod) in `src/routes/telemetry.js`.
   - Invalid payloads return `400 Bad Request` immediately and increment `witsml_telemetry_batches_total{status="validation_error"}`.
   - Valid payloads increment `witsml_telemetry_batches_total{status="accepted"}` and `witsml_telemetry_points_total`, persist the raw JSONB window to the `telemetry_batches` hypertable in TimescaleDB, enqueue asynchronous AI analysis (`analyzeRigStateAsync`), and return `202 Accepted` so rig telemetry producers are never blocked by LLM inference latency.

2. **Hybrid Deterministic + Local LLM Evaluation (`src/services/ai.js`):**
   - **FIFO Inference Queue:** Enqueues incoming telemetry windows with concurrency `1` (`drainInferenceQueue`) and tracks backpressure via the `witsml_ai_queue_depth` Prometheus gauge.
   - **Deterministic SOP Pre-Check (`evaluateSopDeterministic`):** Reads active SOP thresholds (`min_wob`, `min_rpm`, `min_flow`, `max_conn_time`) from memory (`O(1)`) and evaluates `drilling`, `drilling_dysfunction`, `connection`, `circulating`, and `circulation_loss` states.
   - **Cached LLM Chain & Inequality Sanitization:** Invokes local Ollama (`qwen2.5:1.5b`) with `temperature: 0`, `numCtx: 512`, `numPredict: 120`, `keepAlive: "24h"`, and compact window statistics (`compactTelemetryForPrompt`). Output is parsed via Zod `StructuredOutputParser` and verified by `sanitizeJustification` so small-model symbol inversions (`<` vs `>`) or boolean hallucinations never reach storage.
   - **Zero-Downtime Deterministic Failover:** If Ollama is unreachable or times out, `processSingleBatch` automatically falls back to the deterministic SOP assessment (`fallback: true`, `deterministic-sop-fallback`).
   - **Metrics:** Records inference latency in `witsml_ai_inference_duration_seconds` and increments `witsml_ai_decisions_total`, `witsml_ilt_detections_total`, and `witsml_ilt_duration_seconds_total`.

3. **Persistence, Query APIs & Real-Time Streaming (`src/services/db.js`, `src/utils/logger.js`, `src/index.js`):**
   - Persists each enriched assessment (`rig_id`, `well_id`, `declared_op`, `actual_state`, `is_ilt`, `ilt_duration_seconds`, `confidence_score`, `justification`) to the `ai_decisions` hypertable in TimescaleDB.
   - Appends an immutable audit entry to `logs/llm-audit.jsonl`.
   - Broadcasts decisions over Server-Sent Events (`GET /api/stream`, with 25-second `: heartbeat` keep-alives) to the live web console (`public/index.html`).
   - Exposes `GET /api/decisions` (with `?rig_id=`, `?well_id=`, `?is_ilt=` filters), `GET /api/batches`, `GET /api/stats`, and `GET /ready` (live TimescaleDB + Ollama health & latency probes).

4. **Observability & Alerting (`Prometheus` + `Grafana`):**
   - Prometheus (`:9090`) scrapes `http://witsml-agent:3000/metrics` every 15 seconds and evaluates 4 alerting rules in `alert.rules.yml` (`RepeatedIltDetected`, `AiInferenceQueueBacklog`, `SlowEdgeAiInference`, `WitsmlEdgeAgentDown`).
   - Grafana (`:3001`) connects to both `Prometheus` and `TimescaleDB` via declarative provisioning (`grafana/provisioning/`) and renders the 9-panel **WITSML Edge AI & Rig Telemetry Overview** dashboard (`witsml-overview.json`).

## TimescaleDB Hypertables, Indexes & Retention (`init.sql`)

- **`telemetry_batches`**: Partitioned on `timestamp TIMESTAMPTZ`, indexed on `(rig_id, timestamp DESC)` (`idx_telemetry_batches_rig_time`), with a **30-day automatic retention policy**.
- **`ai_decisions`**: Partitioned on `timestamp TIMESTAMPTZ`, indexed on `(rig_id, timestamp DESC)` (`idx_ai_decisions_rig_time`) and `(is_ilt, timestamp DESC)` (`idx_ai_decisions_is_ilt`), with a **90-day automatic retention policy**.
