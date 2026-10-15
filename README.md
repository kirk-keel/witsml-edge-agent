# WITSML Telemetry Agent: Air-Gapped Edge AI ILT Detection

**An enterprise architecture pattern for parsing high-frequency rig telemetry, executing agentic operational analysis, and programmatically eliminating Invisible Lost Time (ILT)—designed specifically for remote, zero-trust field environments.**

---

## 📈 Executive Summary & Business Value
Traditional deterministic threshold logic for rig state classification frequently fails due to noisy sensor data and varying rig profiles. This forces engineers to manually audit drilling logs to identify operational inefficiencies. 

This architecture solves that by deploying a containerized, agentic LLM pipeline that ingests simulated WITSML streaming data. By applying physics-based constraints to a Large Language Model, the system autonomously identifies actual rig states (e.g., drilling vs. slip-to-slip connections) and mathematically calculates accumulated Invisible Lost Time (ILT).

## 🔒 Air-Gapped Edge Architecture (Zero Cloud Dependency)
Offshore rigs and remote Permian pads cannot rely on stable satellite internet for critical AI operations. This repository demonstrates a **100% locally hosted, air-gapped architecture**:
*   **Edge Inference:** Powered by a local reasoning model (`Llama 3.1`) running via an Ollama Docker container.
*   **Zero Data Egress:** WITSML telemetry data never leaves the internal network, ensuring strict compliance with enterprise data privacy standards.
*   **Zero-Cost Scaling:** Completely bypasses third-party API token costs, enabling high-frequency telemetry parsing at scale.

## 🏗️ System Architecture
*   **Ingestion Layer (Node.js/Express):** Secure REST API receiving downsampled telemetry payloads (10-second intervals) from the rig's edge aggregator.
*   **Validation Layer (Zod):** Strict schema contracts that drop malformed sensor payloads immediately before they consume compute resources.
*   **AI Reasoning Engine (LangChain):** Evaluates 5-minute telemetry windows against defined operational benchmarks to override inaccurate manual rig states.
*   **LLMOps Audit Trail:** Append-only JSONL logging (`/logs/llm-audit.jsonl`) for complete, deterministic traceability of AI operational decisions.

## 🚀 Local Deployment
1. Clone the repository: `git clone https://github.com/kirk-keel/witsml-agent.git`
2. Ensure a local Ollama instance is running Llama 3.1.
3. Configure your environment: `cp .env.example .env` (Point `OLLAMA_BASE_URL` to your local host)
4. Spin up the ingestion API: `docker-compose up -d`
5. Run the simulated edge payload: `npm run test:payload`
