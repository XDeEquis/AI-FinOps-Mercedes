const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
// const axios = require('axios'); // Descomentar al final del hackathon

const db = new sqlite3.Database('./finops.sqlite', (err) => {
    if (err) console.error("Error al abrir SQLite en el proxy:", err.message);
});

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
        db.get(`SELECT presupuesto_maximo, gasto_acumulado FROM consumidores WHERE id = ?`, [consumerId], async (err, row) => {
            if (err) return res.status(500).json({ error: "Error al consultar la base de datos" });
            if (!row) return res.status(404).json({ error: `Consumidor '${consumerId}' no registrado en FinOps` });

            const currentSpend = row.gasto_acumulado;
            const monthlyBudget = row.presupuesto_maximo;

            // Bloqueo si ya no hay dinero
            if (currentSpend >= monthlyBudget) {
                console.log(`[FINOPS] 🛑 BLOQUEO: Presupuesto agotado para ${consumerId}.`);
                return res.status(403).json({ 
                    error: "Presupuesto mensual de IA agotado.",
                    detail: `Has gastado $${currentSpend.toFixed(4)} de tus $${monthlyBudget} permitidos.`
                });
            }

            let targetModel = requestedModel || 'llama3.2:3b';
            let routingReason = "Modelo por defecto solicitado.";

            const tokensEstimadosInput = Math.ceil(promptString.length / 4);

            // Vuestra nueva regla de Longitud/Palabras clave:
            const palabrasComplejas = ["programa", "analiza", "razona", "resume"];
            const requiereAltoRazonamiento = palabrasComplejas.some(p => promptString.toLowerCase().includes(p));

            if (tokensEstimadosInput > 100) {
                targetModel = 'llama3.2:3b'; // Forzamos el barato por ser prompt caro
                routingReason = `Prompt Caro (${tokensEstimadosInput} tokens). Enrutando a Modelo Barato para ahorrar.`;
            } else if (requiereAltoRazonamiento) {
                targetModel = 'mistral:7b';
                routingReason = "Prompt Corto pero Complejo. Requiere alta capacidad de Mistral.";
            } else {
                targetModel = 'llama3.2:3b';
                routingReason = "Tarea trivial o corta. Enrutando a Modelo Base.";
            }

            console.log(`[FINOPS] 🔀 Decisión de routing: ${targetModel} | Motivo: ${routingReason}`);

            // 4. LLAMADA AL PROVEEDOR LLM (Simulada por ahora)
            const estimatedPromptTokens = tokensEstimadosInput;
            const simulatedCompletionTokens = 45;

            const usage = {
                prompt_tokens: estimatedPromptTokens,
                completion_tokens: simulatedCompletionTokens
            };

            const mockResponse = {
                model: targetModel,
                choices: [{ message: { role: "assistant", content: `Respuesta simulada generada desde ${targetModel}` } }],
                usage: usage
            };

            // 5. CÁLCULO DE COSTES EXACTOS
            const modelPricing = PRICING[targetModel];
            const costInput = (usage.prompt_tokens / 1000000) * modelPricing.input;
            const costOutput = (usage.completion_tokens / 1000000) * modelPricing.output;
            const totalCostUsd = costInput + costOutput;

            console.log(`[FINOPS] 💰 Tokens: In(${usage.prompt_tokens}) Out(${usage.completion_tokens})`);
            console.log(`[FINOPS] 💸 Coste calculado: $${totalCostUsd.toFixed(6)}`);

            // 6. GUARDAR AUDITORÍA Y ACTUALIZAR SALDO (Pilar 1 y 2)
            // 🗄️ INTEGRACIÓN SQLITE: Ejecutamos los cambios de forma secuencial
            db.serialize(() => {
                // Actualizamos el gasto del consumidor sumando el coste de esta llamada
                db.run(`UPDATE consumidores SET gasto_acumulado = gasto_acumulado + ? WHERE id = ?`, [totalCostUsd, consumerId]);

                // Insertamos la fila en el historial de auditoría
                db.run(`INSERT INTO auditoria_llamadas (consumidor_id, modelo_usado, tokens_input, tokens_output, coste_total) 
                        VALUES (?, ?, ?, ?, ?)`, [consumerId, targetModel, usage.prompt_tokens, usage.completion_tokens, totalCostUsd]);
            });

            // 7. RESPONDER AL USUARIO
            return res.json(mockResponse);
        });
    } catch (error) {
        console.error("[PROXY ERROR] ❌", error.message);
        res.status(500).json({ error: "Fallo interno en la capa de IA FinOps." });
    }
});

module.exports = router;