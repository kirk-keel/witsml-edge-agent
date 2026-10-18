const { ChatOllama } = require("@langchain/ollama");
const { PromptTemplate } = require("@langchain/core/prompts");
const { StructuredOutputParser } = require("@langchain/core/output_parsers");
const { z } = require("zod");
const fs = require('fs');
const path = require('path');
const { logAiDecision } = require('../utils/logger');

const outputParser = StructuredOutputParser.fromZodSchema(
    z.object({
        actual_state: z.string(),
        is_ilt: z.boolean(),
        ilt_duration_seconds: z.number(),
        confidence_score: z.number(),
        justification: z.string().describe("Strict engineering logic. State the exact numeric comparisons factually without hallucinating (e.g., 'Actual WOB 18 is > min 5 required').")
    })
);

async function analyzeRigStateAsync(data) {
    try {
        const configPath = path.join(__dirname, '../sop-config.json');
        const sopConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

        const model = new ChatOllama({
            baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
            model: "llama3.1", // Hardcoded to bypass Qwen 3B and enforce Llama 3.1 8B
            temperature: 0,
            format: "json"
        });

        const prompt = new PromptTemplate({
            template: `Analyze this WITSML telemetry against the Operating Rules.
### Rules:
1. Drilling: WOB > {min_wob}, RPM > {min_rpm}, Flow > {min_flow}.
2. Connection: Max {max_conn_time}s.

### Payload:
Declared: {declared_op}
Telemetry: {telemetry_data}

### Output:
Output raw JSON. Your 'justification' field must strictly state the factual math (e.g., 'Actual Flow 400 is > required 100'). Do not contradict the telemetry.`,
            inputVariables: ["declared_op", "telemetry_data", "min_wob", "min_rpm", "min_flow", "max_conn_time"]
        });

        const chain = prompt.pipe(model).pipe(outputParser);
        const result = await chain.invoke({
            declared_op: data.metadata.active_operation,
            telemetry_data: JSON.stringify(data.telemetry),
            min_wob: sopConfig.min_wob,
            min_rpm: sopConfig.min_rpm,
            min_flow: sopConfig.min_flow,
            max_conn_time: sopConfig.max_conn_time
        });

        if (global.broadcastToDashboard) global.broadcastToDashboard(result);
        logAiDecision(data.metadata, "local-compute-0-cost", result);
        return result;
    } catch (error) {
        console.error(error);
    }
}

module.exports = { analyzeRigStateAsync };
