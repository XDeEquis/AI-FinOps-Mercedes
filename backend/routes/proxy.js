const express = require('express');
const router = express.Router();
// const axios = require('axios'); // Descomentar al final del hackathon
// const db = require('../db');    // Lo crearemos en el siguiente paso para PostgreSQL

// Tarifas extraídas de las bases del hackathon (Coste por 1 Millón de Tokens en USD)
const PRICING = {
    'llama3.2:3b': { input: 0.06, output: 0.06 },           // Provider A (Local)
    'mistral:7b': { input: 0.24, output: 0.24 },            // Provider B (Local)
    'llama-3.1-8b-instant': { input: 0.05, output: 0.08 }   // Provider C (Groq)
};

/* GET Health Check */
router.get('/', (req, res) => res.json({ status: "ok", message: "AI FinOps Proxy Operativo 🟢" }));

/* POST Interceptor Principal */
router.post('/v1/chat/completions', async (req, res, next) => {
    try {
        // 1. IDENTIDAD Y VISIBILIDAD (Pilar 1)
        const consumerId = req.headers['x-consumer-id'];
        if (!consumerId) {
            return res.status(400).json({ error: "Falta la cabecera x-consumer-id" });
        }

        const { model: requestedModel, messages } = req.body;
        const promptString = messages.map(m => m.content).join(" ");

        console.log(`\n[PROXY] 🚦 Petición de [${consumerId}] | Modelo solicitado: ${requestedModel}`);

        // 2. CONTROL DE PRESUPUESTO Y GOBERNANZA (Pilar 2)
        // TODO: Reemplazar con consulta real a PostgreSQL: SELECT monthly_budget_usd, current_spend_usd FROM consumers...
        const currentSpend = 4.80;   // Dato simulado temporal
        const monthlyBudget = 5.00;  // Dato simulado temporal

        if (currentSpend >= monthlyBudget) {
            console.log(`[FINOPS] 🛑 BLOQUEO: Presupuesto agotado para ${consumerId}.`);
            return res.status(403).json({ error: "Presupuesto mensual de IA agotado. Contacta con Finanzas." });
        }

        // 3. ENRUTAMIENTO INTELIGENTE Y OPTIMIZACIÓN (Pilar 3)
        let targetModel = requestedModel || 'llama3.2:3b';
        let routingReason = "Modelo por defecto solicitado.";

        // Regla A: Degradación por presupuesto crítico (>90% gastado)
        if (currentSpend > (monthlyBudget * 0.90)) {
            targetModel = 'llama3.2:3b';
            routingReason = "Presupuesto crítico (>90%). Forzando modelo con coste de salida más económico.";
        }
        // Regla B: Ahorro en prompts masivos (>200 caracteres de ejemplo)
        else if (promptString.length > 200) {
            targetModel = 'llama-3.1-8b-instant';
            routingReason = "Prompt extenso detectado. Enrutando a Groq por tener el coste de input más bajo ($0.05).";
        }

        console.log(`[FINOPS] 🔀 Decisión de routing: ${targetModel} | Motivo: ${routingReason}`);

        // 4. LLAMADA AL PROVEEDOR LLM
        // TODO: Aquí iría la llamada real con Axios usando targetModel.
        // Simulamos la respuesta y el consumo de tokens para poder programar la BBDD:
        const estimatedPromptTokens = Math.ceil(promptString.length / 4); // Regla general empírica
        const simulatedCompletionTokens = 45;

        const usage = {
            prompt_tokens: estimatedPromptTokens,
            completion_tokens: simulatedCompletionTokens
        };

        const mockResponse = {
            model: targetModel,
            choices: [{ message: { role: "assistant", content: `Respuesta generada desde ${targetModel}` } }],
            usage: usage
        };

        // 5. CÁLCULO DE COSTES EXACTOS
        const modelPricing = PRICING[targetModel];
        const costInput = (usage.prompt_tokens / 1000000) * modelPricing.input;
        const costOutput = (usage.completion_tokens / 1000000) * modelPricing.output;
        const totalCostUsd = costInput + costOutput;

        console.log(`[FINOPS] 💰 Tokens: In(${usage.prompt_tokens}) Out(${usage.completion_tokens})`);
        console.log(`[FINOPS] 💸 Coste calculado: $${totalCostUsd.toFixed(6)}`);

        // 6. GUARDAR AUDITORÍA Y ACTUALIZAR SALDO
        // TODO: Hacer el INSERT en 'audit_logs' y el UPDATE en 'consumers' en PostgreSQL.

        // 7. RESPONDER AL USUARIO
        res.json(mockResponse);

    } catch (error) {
        console.error("[PROXY ERROR] ❌", error.message);
        res.status(500).json({ error: "Fallo interno en la capa de IA FinOps." });
    }
});

module.exports = router;