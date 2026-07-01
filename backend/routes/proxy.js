const express = require('express');
const axios = require('axios');
const router = express.Router();
const db = require('../db');

// Activar esto (variable de entorno ENABLE_REAL_PROVIDERS=true) SOLO cuando
// los contenedores de Ollama estén levantados (docker compose up) y con
// modelos descargados (task pull). Por defecto seguimos en modo simulación,
// tal y como pidieron los organizadores para priorizar la lógica FinOps.
const REAL_PROVIDERS_ENABLED = process.env.ENABLE_REAL_PROVIDERS === 'true';
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Punto de integración opcional para notificaciones externas (email vía
// servicio de terceros, Slack, Teams...). Si no se configura, las alertas
// solo quedan registradas en BD y visibles en la UI/consola (sigue cumpliendo
// el requisito de "notificación visible por cualquier canal").
const ALERT_WEBHOOK_URL = process.env.FINOPS_ALERT_WEBHOOK_URL;

const DEFAULT_MODEL = 'llama3.2:3b';

const ROUTING_CONFIG = {
    budgetWarningRatio: 0.8,
    budgetCriticalRatio: 0.9,
    longPromptTokens: 100,
    models: {
        cheap: 'llama3.2:3b',
        reasoning: 'mistral:7b'
    },
    // Palabras clave que indican una tarea de razonamiento/código, no de
    // charla trivial. Usamos \b (límite de palabra) para no disparar con
    // coincidencias parciales dentro de otras palabras (p. ej. "ruta" no
    // debe activar "razona").
    keywordsReasoning: [
        'programa', 'programar', 'codigo', 'código', 'algoritmo', 'depura', 'depurar',
        'analiza', 'analizar', 'razona', 'razonar', 'compara', 'comparar',
        'disena', 'diseña', 'diseñar', 'arquitectura', 'planifica', 'planificar',
        'resume', 'resumir', 'optimiza', 'optimizar', 'sql', 'consulta', 'query'
    ]
};

function buildReasoningRegex() {
    const escaped = ROUTING_CONFIG.keywordsReasoning.map((word) =>
        word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    );
    return new RegExp(`\\b(${escaped.join('|')})\\w*`, 'i');
}

const REASONING_REGEX = buildReasoningRegex();

function classifyPrompt(promptString, estimatedPromptTokens) {
    if (estimatedPromptTokens > ROUTING_CONFIG.longPromptTokens) {
        return {
            targetModel: ROUTING_CONFIG.models.cheap,
            routingMethod: 'cost_guardrail_long_prompt',
            routingReason: `Prompt largo (${estimatedPromptTokens} tokens estimados). Priorizamos el modelo de menor coste.`
        };
    }

    if (REASONING_REGEX.test(promptString)) {
        return {
            targetModel: ROUTING_CONFIG.models.reasoning,
            routingMethod: 'quality_reasoning_keywords',
            routingReason: 'Prompt corto pero de razonamiento/código. Priorizamos calidad con Mistral.'
        };
    }

    return {
        targetModel: ROUTING_CONFIG.models.cheap,
        routingMethod: 'default_low_cost',
        routingReason: 'Tarea simple o general. Priorizamos el modelo base de bajo coste.'
    };
}

/**
 * Llama al proveedor real (Ollama u OpenAI-compatible) cuando está activado.
 * Si falla o está desactivado, se usa una respuesta simulada para no romper
 * la demo mientras los contenedores no estén disponibles.
 */
async function callProvider(modelRow, messages) {
    if (!REAL_PROVIDERS_ENABLED) {
        return null;
    }

    try {
        const headers = { 'Content-Type': 'application/json' };
        if (modelRow.model_id === 'llama-3.1-8b-instant') {
            if (!GROQ_API_KEY) {
                console.warn('[PROVIDER] ⚠️ GROQ_API_KEY no configurada. Usando simulación.');
                return null;
            }
            headers.Authorization = `Bearer ${GROQ_API_KEY}`;
        }

        const response = await axios.post(
            `${modelRow.base_url}/chat/completions`,
            { model: modelRow.model_id, messages },
            { headers, timeout: 15000 }
        );

        return response.data;
    } catch (error) {
        console.error(`[PROVIDER ERROR] ❌ ${modelRow.model_id}:`, error.message);
        return null;
    }
}

/**
 * Emite una alerta de FinOps por todos los canales disponibles:
 * 1) Log en consola del proxy (siempre).
 * 2) Persistencia en la tabla `notifications` (histórico auditable).
 * 3) Webhook externo opcional (FINOPS_ALERT_WEBHOOK_URL) para integrarlo con
 *    email/Slack/Teams sin tocar código.
 * 4) Se devuelve en la respuesta HTTP para que el frontend la pinte al instante.
 */
async function emitAlert({ consumerId, level, message }) {
    console.warn(`[ALERT] 🔔 [${level.toUpperCase()}] (${consumerId}) ${message}`);

    try {
        await db.insertNotification({ consumerId, level, message, channel: ALERT_WEBHOOK_URL ? 'ui+webhook' : 'ui' });
    } catch (error) {
        console.error('[ALERT ERROR] ❌ No se pudo persistir la notificación:', error.message);
    }

    if (ALERT_WEBHOOK_URL) {
        axios.post(ALERT_WEBHOOK_URL, {
            consumer_id: consumerId,
            level,
            message,
            timestamp: new Date().toISOString()
        }, { timeout: 5000 }).catch((error) => {
            console.error('[WEBHOOK ERROR] ❌ No se pudo notificar al webhook externo:', error.message);
        });
    }

    return { level, message };
}

/* GET Health Check */
router.get('/', (req, res) => {
    res.json({
        status: 'ok',
        message: 'AI FinOps Proxy Operativo',
        real_providers_enabled: REAL_PROVIDERS_ENABLED,
        timestamp: new Date().toISOString()
    });
});

/* GET catálogo de modelos activos (fuente de verdad para el frontend) */
router.get('/v1/models', async (req, res) => {
    try {
        const models = await db.listActiveModels();
        res.json({ data: models });
    } catch (error) {
        console.error('[MODELS ERROR] ❌', error.message);
        res.status(500).json({ error: 'No fue posible listar los modelos activos.' });
    }
});

/* GET resumen de consumo de un consumidor (para el sidebar del frontend) */
router.get('/v1/consumers/:consumerId/summary', async (req, res) => {
    try {
        const summary = await db.getConsumerSummary(req.params.consumerId);
        if (!summary) {
            return res.status(404).json({ error: `Consumidor no encontrado: ${req.params.consumerId}` });
        }

        res.json({
            id: summary.id,
            name: summary.name,
            department: summary.department,
            monthly_budget_usd: summary.monthly_budget_usd,
            current_spend_usd: summary.current_spend_usd,
            remaining_budget_usd: Math.max(0, summary.monthly_budget_usd - summary.current_spend_usd),
            requests_count: summary.requests_count,
            total_prompt_tokens: summary.total_prompt_tokens,
            total_completion_tokens: summary.total_completion_tokens
        });
    } catch (error) {
        console.error('[SUMMARY ERROR] ❌', error.message);
        res.status(500).json({ error: 'No fue posible calcular el resumen de consumo.' });
    }
});

/* GET dataset agregado para dashboard Streamlit / FinOps Flow */
router.get('/v1/flow-dashboard', async (req, res) => {
    try {
        const dashboardData = await db.getFlowDashboardData();
        res.json(dashboardData);
    } catch (error) {
        console.error('[FLOW DASHBOARD ERROR] ❌', error.message);
        res.status(500).json({ error: 'No fue posible generar los datos del dashboard FinOps.' });
    }
});

/* PATCH ajuste manual de presupuesto/gasto — SOLO para demo en vivo (Pilar 2) */
router.patch('/v1/consumers/:consumerId/spend', async (req, res) => {
    try {
        const { current_spend_usd: currentSpendUsd } = req.body;
        if (typeof currentSpendUsd !== 'number' || currentSpendUsd < 0) {
            return res.status(400).json({ error: 'current_spend_usd debe ser un número >= 0.' });
        }

        const consumer = await db.getConsumerById(req.params.consumerId);
        if (!consumer) {
            return res.status(404).json({ error: `Consumidor no encontrado: ${req.params.consumerId}` });
        }

        const updated = await db.setConsumerSpend(req.params.consumerId, currentSpendUsd);
        res.json(updated);
    } catch (error) {
        console.error('[SPEND ERROR] ❌', error.message);
        res.status(500).json({ error: 'No fue posible actualizar el gasto del consumidor.' });
    }
});

/* PATCH ajuste del límite de presupuesto mensual de un equipo (config en caliente) */
router.patch('/v1/consumers/:consumerId/budget', async (req, res) => {
    try {
        const { monthly_budget_usd: monthlyBudgetUsd } = req.body;
        if (typeof monthlyBudgetUsd !== 'number' || monthlyBudgetUsd < 0) {
            return res.status(400).json({ error: 'monthly_budget_usd debe ser un número >= 0.' });
        }

        const consumer = await db.getConsumerById(req.params.consumerId);
        if (!consumer) {
            return res.status(404).json({ error: `Consumidor no encontrado: ${req.params.consumerId}` });
        }

        const updated = await db.setConsumerBudget(req.params.consumerId, monthlyBudgetUsd);
        res.json(updated);
    } catch (error) {
        console.error('[BUDGET ERROR] ❌', error.message);
        res.status(500).json({ error: 'No fue posible actualizar el presupuesto del consumidor.' });
    }
});

/* GET listado de consumidores (para pantallas de administración/demo) */
router.get('/v1/consumers', async (req, res) => {
    try {
        const consumers = await db.listConsumers();
        res.json({ data: consumers, default_budget_usd: db.DEFAULT_BUDGET_USD });
    } catch (error) {
        console.error('[CONSUMERS ERROR] ❌', error.message);
        res.status(500).json({ error: 'No fue posible listar los consumidores.' });
    }
});

/* GET historial de notificaciones/alertas de presupuesto (para UI y dashboard) */
router.get('/v1/notifications', async (req, res) => {
    try {
        const { consumerId, limit } = req.query;
        const notifications = await db.listNotifications({
            consumerId: consumerId || undefined,
            limit: limit ? Number(limit) : 50
        });
        res.json({ data: notifications });
    } catch (error) {
        console.error('[NOTIFICATIONS ERROR] ❌', error.message);
        res.status(500).json({ error: 'No fue posible obtener las notificaciones.' });
    }
});

/* POST Interceptor Principal */
router.post('/v1/chat/completions', async (req, res) => {
    try {
        // 1. IDENTIDAD Y VISIBILIDAD (Pilar 1)
        const consumerId = req.headers['x-consumer-id'];
        if (!consumerId) {
            return res.status(400).json({ error: 'Falta la cabecera x-consumer-id' });
        }
        // Identidad individual opcional (para el desglose "por persona" del
        // dashboard). No es obligatoria: sin ella, el proxy sigue funcionando
        // a nivel de equipo igual que antes.
        const userName = typeof req.headers['x-user-name'] === 'string' ? req.headers['x-user-name'].slice(0, 80) : null;

        const { model: requestedModel, messages } = req.body;
        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: 'El campo messages debe ser un array no vacío.' });
        }

        const hasInvalidMessage = messages.some(
            (message) => !message || typeof message.content !== 'string' || message.content.trim().length === 0
        );
        if (hasInvalidMessage) {
            return res.status(400).json({ error: 'Cada message debe incluir content como string no vacío.' });
        }

        const promptString = messages.map((m) => m.content).join(' ').trim();

        console.log(`\n[PROXY] 🚦 Petición de [${consumerId}] | Modelo solicitado: ${requestedModel || '(auto)'}`);

        // 2. CONTROL DE PRESUPUESTO Y GOBERNANZA (Pilar 2)
        const consumer = await db.getConsumerById(consumerId);
        if (!consumer) {
            return res.status(404).json({ error: `Consumidor '${consumerId}' no registrado en FinOps` });
        }

        const currentSpend = consumer.current_spend_usd;
        const monthlyBudget = consumer.monthly_budget_usd;

        if (currentSpend >= monthlyBudget) {
            console.log(`[FINOPS] 🛑 BLOQUEO: Presupuesto agotado para ${consumerId}.`);
            const blockMessage = `${consumer.name}: presupuesto mensual agotado. Gastado $${currentSpend.toFixed(4)} de $${monthlyBudget.toFixed(2)}.`;
            const alert = await emitAlert({ consumerId, level: 'blocked', message: blockMessage });
            return res.status(403).json({
                error: 'Presupuesto mensual de IA agotado.',
                detail: `Has gastado $${currentSpend.toFixed(4)} de tus $${monthlyBudget.toFixed(2)} permitidos.`,
                alert,
                finops: {
                    consumer_id: consumerId,
                    current_spend_usd: Number(currentSpend.toFixed(8)),
                    monthly_budget_usd: Number(monthlyBudget.toFixed(2)),
                    remaining_budget_usd: 0
                }
            });
        }

        // 3. ENRUTAMIENTO INTELIGENTE (Pilar 3)
        const tokensEstimadosInput = Math.ceil(promptString.length / 4) || 1;

        let targetModel = requestedModel || DEFAULT_MODEL;
        let routingMethod = 'manual_request_honored';
        let routingReason = 'Se respeta el modelo solicitado por el cliente.';

        if (currentSpend >= monthlyBudget * ROUTING_CONFIG.budgetCriticalRatio) {
            targetModel = ROUTING_CONFIG.models.cheap;
            routingMethod = 'budget_guardrail_critical';
            routingReason = 'Presupuesto crítico (>90%). Se fuerza el modelo de menor coste.';
        } else if (!requestedModel) {
            const decision = classifyPrompt(promptString, tokensEstimadosInput);
            targetModel = decision.targetModel;
            routingMethod = decision.routingMethod;
            routingReason = decision.routingReason;
        } else {
            const requestedModelRow = await db.getModelById(requestedModel);
            if (!requestedModelRow) {
                targetModel = ROUTING_CONFIG.models.cheap;
                routingMethod = 'fallback_invalid_requested_model';
                routingReason = `Modelo solicitado no soportado: ${requestedModel}. Fallback a ${ROUTING_CONFIG.models.cheap}.`;
            }
        }

        const targetModelRow = await db.getModelById(targetModel);
        if (!targetModelRow) {
            return res.status(503).json({ error: `El modelo elegido no está disponible: ${targetModel}` });
        }

        console.log(`[FINOPS] 🔀 Decisión de routing: ${targetModel} | Método: ${routingMethod} | Motivo: ${routingReason}`);

        // 4. LLAMADA AL PROVEEDOR (real si ENABLE_REAL_PROVIDERS=true, si no, simulada)
        const providerResponse = await callProvider(targetModelRow, messages);

        let usage;
        let assistantContent;

        if (providerResponse && providerResponse.usage) {
            usage = providerResponse.usage;
            assistantContent = providerResponse.choices?.[0]?.message?.content || '(respuesta vacía del proveedor)';
        } else {
            const simulatedCompletionTokens = Math.max(30, Math.ceil(tokensEstimadosInput * 0.35));
            usage = { prompt_tokens: tokensEstimadosInput, completion_tokens: simulatedCompletionTokens };
            assistantContent = `Respuesta simulada generada desde ${targetModel}. (Modo simulación: activa ENABLE_REAL_PROVIDERS=true tras 'docker compose up' para respuestas reales)`;
        }

        // 5. CÁLCULO DE COSTES EXACTOS (precios reales desde la tabla `models`)
        const costInput = (usage.prompt_tokens / 1_000_000) * targetModelRow.input_cost_per_million;
        const costOutput = (usage.completion_tokens / 1_000_000) * targetModelRow.output_cost_per_million;
        const totalCostUsd = costInput + costOutput;

        // 5b. AHORRO ESTIMADO: cuánto habría costado esta misma petición si se
        // hubiese enrutado siempre al modelo más caro del catálogo (línea base).
        // Es la métrica clave que el dashboard usa para justificar el routing.
        let estimatedSavingsUsd = 0;
        if (targetModel !== db.BASELINE_MODEL_ID) {
            const baselineModelRow = await db.getModelById(db.BASELINE_MODEL_ID);
            if (baselineModelRow) {
                const baselineCost =
                    (usage.prompt_tokens / 1_000_000) * baselineModelRow.input_cost_per_million +
                    (usage.completion_tokens / 1_000_000) * baselineModelRow.output_cost_per_million;
                estimatedSavingsUsd = Math.max(0, baselineCost - totalCostUsd);
            }
        }

        console.log(`[FINOPS] 💰 Tokens: In(${usage.prompt_tokens}) Out(${usage.completion_tokens})`);
        console.log(`[FINOPS] 💸 Coste calculado: $${totalCostUsd.toFixed(6)} | Ahorro estimado: $${estimatedSavingsUsd.toFixed(6)}`);

        // 6. GUARDAR AUDITORÍA Y ACTUALIZAR SALDO (Pilar 1 y 2), en transacción
        await db.recordUsageAndUpdateSpend({
            consumerId,
            userName,
            requestedModel,
            targetModel,
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalCostUsd,
            estimatedSavingsUsd,
            routingMethod,
            routingReason
        });

        const updatedConsumer = await db.getConsumerById(consumerId);
        const updatedRatio = monthlyBudget > 0 ? updatedConsumer.current_spend_usd / monthlyBudget : 0;

        // 6b. NOTIFICACIÓN VISIBLE si el equipo cruza el umbral crítico/de aviso.
        let alert = null;
        if (updatedRatio >= ROUTING_CONFIG.budgetCriticalRatio) {
            alert = await emitAlert({
                consumerId,
                level: 'critical',
                message: `${consumer.name} ha superado el ${Math.round(updatedRatio * 100)}% de su presupuesto mensual ($${updatedConsumer.current_spend_usd.toFixed(4)} de $${monthlyBudget.toFixed(2)}). Enrutando solo al modelo más barato.`
            });
        } else if (updatedRatio >= ROUTING_CONFIG.budgetWarningRatio) {
            alert = await emitAlert({
                consumerId,
                level: 'warning',
                message: `${consumer.name} ha usado el ${Math.round(updatedRatio * 100)}% de su presupuesto mensual ($${updatedConsumer.current_spend_usd.toFixed(4)} de $${monthlyBudget.toFixed(2)}).`
            });
        }

        // 7. RESPONDER AL USUARIO (formato OpenAI-like + bloque finops)
        return res.json({
            model: targetModel,
            choices: [{ message: { role: 'assistant', content: assistantContent } }],
            usage,
            alert,
            finops: {
                consumer_id: consumerId,
                routing_method: routingMethod,
                routing_reason: routingReason,
                cost_usd: Number(totalCostUsd.toFixed(8)),
                estimated_savings_usd: Number(estimatedSavingsUsd.toFixed(8)),
                current_spend_usd: Number(updatedConsumer.current_spend_usd.toFixed(8)),
                monthly_budget_usd: Number(monthlyBudget.toFixed(2)),
                remaining_budget_usd: Number(Math.max(0, monthlyBudget - updatedConsumer.current_spend_usd).toFixed(8))
            }
        });
    } catch (error) {
        console.error('[PROXY ERROR] ❌', error.message);
        res.status(500).json({ error: 'Fallo interno en la capa de IA FinOps.' });
    }
});

module.exports = router;
