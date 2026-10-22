/**
 * OpenAPI 3.1.0 Specification & Self-Hosted Interactive API Explorer
 */

function getOpenApiSpec() {
    return {
        openapi: '3.1.0',
        info: {
            title: 'WITSML Edge Agent API',
            version: '1.6.0',
            description:
                'Real-time WITSML drilling telemetry ingestion, local LLM (Ollama qwen2.5:1.5b) & deterministic SOP evaluation, Invisible Lost Time (ILT) detection, drilling mechanics (ROP/MSE/Bit Wear/Stick-Slip), early kick/loss well control diagnostics, and TimescaleDB/Prometheus observability.'
        },
        paths: {
            '/health': {
                get: { summary: 'Liveness probe', responses: { '200': { description: 'Healthy status' } } }
            },
            '/ready': {
                get: {
                    summary: 'Deep readiness probe (TimescaleDB, Ollama, Queue, Spool, Cloud Sync)',
                    responses: { '200': { description: 'Readiness payload' } }
                }
            },
            '/metrics': {
                get: { summary: 'Prometheus scrape endpoint', responses: { '200': { description: 'Prometheus text format' } } }
            },
            '/api/v1/telemetry': {
                post: {
                    summary: 'Ingest schema-validated WITSML JSON telemetry window',
                    responses: {
                        '202': { description: 'Accepted for asynchronous AI analysis' },
                        '400': { description: 'Zod schema validation error' },
                        '401': { description: 'Missing or invalid X-Edge-Key' }
                    }
                }
            },
            '/api/v1/witsml/xml': {
                post: {
                    summary: 'Ingest native WITSML v1.4.1.1 / v2.0 <log> XML payload',
                    responses: {
                        '202': { description: 'Parsed and accepted for AI analysis' },
                        '400': { description: 'Malformed WITSML XML' }
                    }
                }
            },
            '/api/sops': {
                get: { summary: 'Get active SOP thresholds (global or ?rig_id=)' },
                post: { summary: 'Update global or per-rig SOP thresholds and spread rate' }
            },
            '/api/sops/profiles': {
                get: { summary: 'List all global and per-rig SOP profiles' }
            },
            '/api/decisions': {
                get: { summary: 'Query recent AI decisions (?limit=&rig_id=&well_id=&is_ilt=)' }
            },
            '/api/decisions/export': {
                get: { summary: 'Download shift Daily Drilling Report (DDR) in CSV (?format=csv) or JSON (?format=json)' }
            },
            '/api/batches': {
                get: { summary: 'Query recent raw WITSML telemetry batches' }
            },
            '/api/alerts': {
                get: { summary: 'List recent ILT and Well Control alert events' }
            },
            '/api/stats': {
                get: { summary: 'Aggregated KPI summary (ILT count, cost, ROP, MSE, Bit Wear, Stick-Slip, Queue, Spool)' }
            },
            '/api/stats/hourly': {
                get: { summary: 'TimescaleDB time_bucket("1 hour") ILT rollup' }
            },
            '/api/fleet/leaderboard': {
                get: { summary: 'Multi-rig efficiency and well control benchmark leaderboard' }
            },
            '/api/cloud-sync/status': {
                get: { summary: 'Get Rig-to-Cloud batch replication status and checkpoint' }
            },
            '/api/cloud-sync/trigger': {
                post: { summary: 'Trigger immediate Rig-to-Cloud batch sync' }
            },
            '/api/stream': {
                get: { summary: 'Server-Sent Events (SSE) real-time assessment stream' }
            }
        }
    };
}

function renderApiDocsHtml() {
    const spec = getOpenApiSpec();
    const rows = Object.entries(spec.paths)
        .flatMap(([pathKey, methods]) =>
            Object.entries(methods).map(
                ([method, meta]) =>
                    `<tr><td><span class="method ${method}">${method.toUpperCase()}</span></td><td><code>${pathKey}</code></td><td>${meta.summary || ''}</td></tr>`
            )
        )
        .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${spec.info.title} — OpenAPI 3.1 Docs</title>
  <style>
    body { background: #0f172a; color: #e2e8f0; font-family: monospace; padding: 28px; margin: 0; }
    h1 { color: #38bdf8; margin-top: 0; }
    a { color: #38bdf8; }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; background: #1e293b; border-radius: 8px; overflow: hidden; }
    th, td { padding: 10px 14px; border-bottom: 1px solid #334155; text-align: left; }
    th { color: #94a3b8; text-transform: uppercase; font-size: 11px; }
    .method { padding: 3px 8px; border-radius: 4px; font-weight: bold; font-size: 11px; }
    .method.get { background: #0284c7; color: #fff; }
    .method.post { background: #10b981; color: #0f172a; }
  </style>
</head>
<body>
  <h1>${spec.info.title} (v${spec.info.version})</h1>
  <p>${spec.info.description}</p>
  <p><a href="/openapi.json">Raw OpenAPI 3.1 JSON (/openapi.json)</a> | <a href="/">Back to Rig Console</a></p>
  <table>
    <thead><tr><th>Method</th><th>Endpoint</th><th>Description</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

module.exports = { getOpenApiSpec, renderApiDocsHtml };
