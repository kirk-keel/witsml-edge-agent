const { ChatOllama } = require("@langchain/ollama");
const { PromptTemplate } = require("@langchain/core/prompts");
const { StructuredOutputParser } = require("@langchain/core/output_parsers");
const { z } = require("zod");
const { logAiDecision } = require('../utils/logger');

const outputParser = StructuredOutputParser.fromZodSchema(
    z.object({
        actual_state: z.string().describe("The true rig state based on physics (e.g., 'drilling', 'connection', 'stationary')."),
        is_ilt: z.boolean().describe("True if Invisible Lost Time occurred."),
        ilt_duration_seconds: z.number().describe("Estimated duration of the ILT in seconds."),
        confidence_score: z.number().min(0).max(100),
        justification: z.string().describe("Engineering justification for the classification.")
    })
);

async function analyzeRigStateAsync(data) {
    console.log(`[Agent Queue] Orchestrating ILT analysis via local homelab for ${data.metadata.rig_id}...`);

    try {
        const model = new ChatOllama({
            baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
            model: process.env.OLLAMA_MODEL_NAME || "llama3.1",
            temperature: 0.1,
            format: "json", // Forces Ollama to strictly adhere to the JSON structure
        });

        const prompt = new PromptTemplate({
            template: `You are an expert Well Control Specialist and Rig Optimization AI.
Analyze the following 5-minute WITSML telemetry window downsampled to 10-second intervals.

### Operating Rules:
1. Drilling: Requires WOB > 5 klbs, RPM > 20, and Flow > 100.
2. Slip-to-Slip Connections: Max 180 seconds. If block is stationary and Flow is 0 for > 180s, flag as ILT.
3. Trust physics over the declared state.

### Output Instructions:
{format_instructions}

### Payload:
Declared Operation: {declared_op}
Telemetry Array: {telemetry_data}`,
            inputVariables: ["declared_op", "telemetry_data"],
            partialVariables: { format_instructions: outputParser.getFormatInstructions() },
        });

        const chain = prompt.pipe(model).pipe(outputParser);
        const result = await chain.invoke({
            declared_op: data.metadata.active_operation,
            telemetry_data: JSON.stringify(data.telemetry)
        });

        console.log(`[AI Assessment] ILT Detected: ${result.is_ilt} | Reason: ${result.justification}`);
        logAiDecision(data.metadata, "local-compute-0-cost", result);
        
        return result;
    } catch (error) {
        console.error("[Agent Error] Failed to process via local model:", error);
    }
}

module.exports = { analyzeRigStateAsync };
