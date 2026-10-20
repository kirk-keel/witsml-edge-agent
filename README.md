# WITSML Edge Agent

Real-time WITSML drilling telemetry analysis with local LLM inference — ILT detection, live dashboard, zero cloud cost.

## What it is

An Express service that ingests WITSML-style telemetry, analyzes it with a locally-hosted LLM (LangChain + Ollama), and streams results to a live dashboard over Server-Sent Events. SOP thresholds are configurable at runtime — no redeploy.

## Why it exists

Invisible Lost Time is drilling time lost to inefficiency that nobody flags in the moment. Cloud LLM analysis is expensive and rate-limited; this runs entirely on homelab hardware over Tailscale, for free.

## Architecture

```mermaid
flowchart LR
    S[WITSML Simulator] -->|POST /api/witsml| A[Express Agent]
    A -->|202 Accepted| S
    A --> L[LangChain + Ollama]
    L --> Z[Zod-validated JSON]
    Z -->|SSE /api/stream| D[Live Dashboard]
    C[SOP Config API] -.-> A
cd ~/repos/witsml-edge-agent

python3 - <<'PY'
import json, pathlib
p = pathlib.Path("package.json")
d = json.loads(p.read_text())
d["name"] = "witsml-edge-agent"
d["description"] = "Real-time WITSML telemetry analysis with local LLM inference"
d["license"] = "MIT"
d["scripts"]["test"] = "node --test test/"
p.write_text(json.dumps(d, indent=2) + "\n")
print("package.json patched")
PY

mkdir -p test
cat > test/smoke.test.js <<'EOF'
const test = require('node:test');
const assert = require('node:assert');

test('logger module loads', () => {
  const logger = require('../src/utils/logger');
  assert.ok(logger);
});
