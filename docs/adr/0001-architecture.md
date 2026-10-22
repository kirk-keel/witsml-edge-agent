# ADR 0001: Asynchronous Edge AI Ingestion with TimescaleDB and Prometheus/Grafana Observability

## Status

Accepted

## Context

Drilling rigs generate continuous WITSML sensor streams where operational inefficiencies—known as Invisible Lost Time (ILT)—often go unnoticed until post-well analysis. Relying on cloud-hosted LLMs introduces high WAN/satellite latency, recurring token costs, and data governance concerns. At the same time, running local LLM inference on compact edge hardware takes several seconds per window, which would block synchronous HTTP telemetry ingestion if coupled directly to the request lifecycle.

## Decision

1. **Decoupled `202 Accepted` Ingestion Pipeline:**
   Validate incoming WITSML windows synchronously with Zod (`src/routes/telemetry.js`), persist the raw batch to TimescaleDB, and return `202 Accepted` immediately while dispatching LangChain + Ollama (`qwen2.5:1.5b`) evaluation asynchronously (`analyzeRigStateAsync`).

2. **Dual Storage in TimescaleDB Hypertables:**
   Persist raw sensor windows as `JSONB` in `telemetry_batches` and structured LLM evaluations in `ai_decisions` (`init.sql`, `src/services/db.js`), enabling both time-series SQL unpacking of drilling parameters (WOB, RPM, Flow, SPP, Hook Load) and historical audit queries (`GET /api/decisions`).

3. **First-Class Prometheus & Grafana Observability:**
   Instrument ingestion counts, sensor point volume, LLM inference latency histograms, and ILT detection counters via `prom-client` (`GET /metrics` in `src/utils/metrics.js`), scraped by Prometheus and visualized alongside TimescaleDB hypertables in a pre-provisioned Grafana container (`grafana/provisioning/`).

## Consequences

- **Positive:** Zero cloud LLM cost; sub-50ms HTTP ingestion response times; resilient time-series storage across container restarts; out-of-the-box Grafana dashboards combining Prometheus operational metrics with TimescaleDB drilling telemetry.
- **Negative / Trade-offs:** Local CPU inference latency (`~10-15s` on compact edge VMs) means AI decisions arrive asynchronously after batch ingestion, tracked explicitly via the `witsml_ai_inference_duration_seconds` histogram.
