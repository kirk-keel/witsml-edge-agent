# WITSML Edge AI Agent: Real-Time Telemetry & ILT Detection

**A zero-cost, locally-hosted edge AI pipeline that applies dynamic SOPs to real-time WITSML drilling telemetry for instant Invisible Lost Time (ILT) detection.**

## Architecture & Tech Stack
* **Infrastructure:** Ubuntu Server Homelab, Docker, Tailscale (Secure remote access without public port forwarding).
* **Backend:** Express/Node.js web server handling concurrent telemetry ingestion and SSE (Server-Sent Events) broadcasting.
* **AI/LLM:** LangChain orchestration wrapping a locally hosted Llama 3.1 (8B) model via Ollama. 
* **UI/UX:** Lightweight, no-build HTML/JS frontend dashboard delivering live streaming AI analysis and dynamic SOP parameter controls.

## Execution & Capabilities
* **Faster-Than-Real-Time Edge Inference:** Processes 5-minute WITSML telemetry windows in under 3 minutes using localized CPU compute, entirely bypassing cloud-vendor token costs and API rate limits.
* **Dynamic SOP Injection:** Operational thresholds (WOB, RPM, Flow) are managed via an isolated configuration state, allowing drilling engineers to update behavioral parameters through the UI without code deployment or container restarts.
* **Schema-Enforced Outputs:** Utilizes Zod schemas to aggressively constrain LLM hallucinations, ensuring the model exclusively outputs valid, highly structured JSON for downstream system integration.
