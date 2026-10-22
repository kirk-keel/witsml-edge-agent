# ADR 0001: Asynchronous Edge AI Ingestion with Hybrid SOP Guardrails, TimescaleDB, and Prometheus/Grafana Observability

## Status

Accepted

## Context

Drilling rigs generate continuous WITSML sensor streams where operational inefficiencies—known as Invisible Lost Time (ILT)—often go unnoticed until post-well analysis. Relying on cloud-hosted LLMs introduces high WAN/satellite latency, recurring token costs, and data governance concerns. At the same time, running local LLM inference (`qwen2.5:1.5b`) on compact edge hardware takes several seconds per window and small 1.5B models can occasionally hallucinate boolean flags or invert `<`/`>` inequality symbols in prose.

## Decision

1. **Decoupled `202 Accepted` Ingestion & Bounded FIFO Queue:**
   Validate incoming WITSML windows synchronously with Zod (`src/routes/telemetry.js`), persist the raw batch to TimescaleDB, and return `202 Accepted` immediately while queuing evaluation through a sequential FIFO inference queue (`analyzeRigStateAsync`, tracked via `witsml_ai_queue_depth`).

2. **Hybrid Deterministic + LLM Evaluation with Zero-Downtime Failover:**
   Pre-compute SOP rule compliance deterministically (`evaluateSopDeterministic` in `src/services/ai.js`), inject compact telemetry summaries (`compactTelemetryForPrompt`) into a cached `ChatOllama` chain (`numCtx: 512`, `numPredict: 120`, `keepAlive: "24h"`), sanitize any inverted inequality signs (`sanitizeJustification`), and automatically fail over to the deterministic SOP assessment if Ollama is unreachable.

3. **Dual TimescaleDB Hypertables with Store-and-Forward Spooling & Retention:**
   Persist raw sensor windows as `JSONB` in `telemetry_batches` (30-day retention) and structured evaluations in `ai_decisions` (90-day retention) with composite indexes on `(rig_id, timestamp DESC)` and `(is_ilt, timestamp DESC)` (`init.sql`, `src/services/db.js`). When TimescaleDB is briefly unreachable, buffer records to `logs/edge-spool.jsonl` (`src/utils/spooler.js`) and replay automatically on reconnect.

4. **Drilling Physics, Well Control & First-Class Prometheus/Grafana Observability:**
   Compute ROP, Teale's MSE, ILT dollar cost (`src/utils/mechanics.js`), Bit Wear / Stick-Slip / Tripping Speed (`src/utils/bit-wear.js`), and early Kick / Lost Circulation diagnostics (`src/utils/wellcontrol.js`). Instrument all metrics via `prom-client` (`GET /metrics` in `src/utils/metrics.js`), evaluated against Prometheus alert rules (`alert.rules.yml`) and visualized alongside TimescaleDB hypertables in a pre-provisioned 14-panel Grafana dashboard (`grafana/provisioning/`).

## Consequences

- **Positive:** Zero cloud LLM cost; sub-50ms HTTP ingestion response times; zero false-positive ILT hallucinations; zero dropped assessments during LLM restarts; self-pruning time-series storage; out-of-the-box Grafana dashboards and Prometheus alerts.
- **Negative / Trade-offs:** Local CPU inference runs sequentially via the FIFO queue (`~5–10s` per batch), tracked explicitly via `witsml_ai_inference_duration_seconds` and `witsml_ai_queue_depth`.
