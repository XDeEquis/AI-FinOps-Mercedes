const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const DB_PATH = process.env.FINOPS_DB_PATH || path.join(__dirname, 'finops.db');
const DEFAULT_BUDGET_USD = 5.0;

const CONSUMERS = [
    { id: 'equipo-marketing', name: 'Equipo Marketing', department: 'marketing', budget: DEFAULT_BUDGET_USD },
    { id: 'equipo-ingenieria', name: 'Equipo Ingeniería', department: 'engineering', budget: DEFAULT_BUDGET_USD },
    { id: 'equipo-ventas', name: 'Equipo Ventas', department: 'sales', budget: DEFAULT_BUDGET_USD },
    { id: 'equipo-soporte', name: 'Equipo Soporte', department: 'support', budget: DEFAULT_BUDGET_USD }
];

const MODELS = [
    { model_id: 'llama3.2:3b', provider: 'Provider A (Ollama local)', input_cost: 0.06, output_cost: 0.06, base_url: 'http://127.0.0.1:11434/v1' },
    { model_id: 'mistral:7b', provider: 'Provider B (Ollama local)', input_cost: 0.24, output_cost: 0.24, base_url: 'http://127.0.0.1:11435/v1' },
    { model_id: 'llama-3.1-8b-instant', provider: 'Provider C (Groq cloud)', input_cost: 0.05, output_cost: 0.08, base_url: 'https://api.groq.com/openai/v1' }
];

const BASELINE_MODEL_ID = 'mistral:7b';

const USER_NAMES = {
    'equipo-marketing': ['Carlos copy', 'Marta rrss', 'Lucia branding'],
    'equipo-ingenieria': ['Sofia dev', 'David backend', 'Andres devops'],
    'equipo-ventas': ['Ana sales', 'Pedro outbound', 'Javier leads'],
    'equipo-soporte': ['Elena support', 'Pablo tickets', 'Raul client-success']
};

const ROUTING_METHODS = [
    'default_low_cost',
    'quality_reasoning_keywords',
    'cost_guardrail_long_prompt',
    'manual_request_honored'
];

async function seed() {
    console.log(`[SEED] Abriendo base de datos en: ${DB_PATH}`);
    const db = await open({
        filename: DB_PATH,
        driver: sqlite3.Database
    });

    console.log('[SEED] Asegurando que los consumidores y modelos por defecto existen...');
    // Inicializar tablas si no existen
    await db.exec(`
        CREATE TABLE IF NOT EXISTS consumers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            department TEXT,
            monthly_budget_usd REAL NOT NULL CHECK (monthly_budget_usd >= 0),
            current_spend_usd REAL NOT NULL DEFAULT 0 CHECK (current_spend_usd >= 0),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS models (
            model_id TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            input_cost_per_million REAL NOT NULL CHECK (input_cost_per_million >= 0),
            output_cost_per_million REAL NOT NULL CHECK (output_cost_per_million >= 0),
            base_url TEXT,
            is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            consumer_id TEXT NOT NULL,
            user_name TEXT,
            requested_model TEXT,
            target_model TEXT NOT NULL,
            prompt_tokens INTEGER NOT NULL CHECK (prompt_tokens >= 0),
            completion_tokens INTEGER NOT NULL CHECK (completion_tokens >= 0),
            total_cost_usd REAL NOT NULL CHECK (total_cost_usd >= 0),
            estimated_savings_usd REAL NOT NULL DEFAULT 0,
            routing_method TEXT NOT NULL,
            routing_reason TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (consumer_id) REFERENCES consumers(id),
            FOREIGN KEY (target_model) REFERENCES models(model_id)
        );

        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            consumer_id TEXT NOT NULL,
            level TEXT NOT NULL CHECK (level IN ('warning', 'critical', 'blocked')),
            message TEXT NOT NULL,
            channel TEXT NOT NULL DEFAULT 'ui',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (consumer_id) REFERENCES consumers(id)
        );
    `);

    console.log('[SEED] Limpiando tablas de logs y notificaciones...');
    await db.exec('DELETE FROM audit_logs');
    await db.exec('DELETE FROM notifications');

    // Insertar modelos y consumidores por defecto
    for (const model of MODELS) {
        await db.run(
            `INSERT OR REPLACE INTO models (model_id, provider, input_cost_per_million, output_cost_per_million, base_url, is_active)
             VALUES (?, ?, ?, ?, ?, 1)`,
            model.model_id, model.provider, model.input_cost, model.output_cost, model.base_url
        );
    }

    for (const consumer of CONSUMERS) {
        await db.run(
            `INSERT OR REPLACE INTO consumers (id, name, department, monthly_budget_usd, current_spend_usd)
             VALUES (?, ?, ?, ?, 0)`,
            consumer.id, consumer.name, consumer.department, consumer.budget
        );
    }

    console.log('[SEED] Generando logs históricos simulados...');

    const now = new Date();
    // Generar logs en los últimos 10 días
    const startDate = new Date();
    startDate.setDate(now.getDate() - 10);

    const totalLogsToGenerate = 150;
    const spendTracker = {
        'equipo-marketing': 0,
        'equipo-ingenieria': 0,
        'equipo-ventas': 0,
        'equipo-soporte': 0
    };

    const notificationThresholds = {
        'equipo-marketing': { warning: false, critical: false, blocked: false },
        'equipo-ingenieria': { warning: false, critical: false, blocked: false },
        'equipo-ventas': { warning: false, critical: false, blocked: false },
        'equipo-soporte': { warning: false, critical: false, blocked: false }
    };

    const baselineModel = MODELS.find(m => m.model_id === BASELINE_MODEL_ID);

    for (let i = 0; i < totalLogsToGenerate; i++) {
        // Distribuir timestamps uniformemente en el rango de 10 días
        const logDate = new Date(startDate.getTime() + (i / totalLogsToGenerate) * (now.getTime() - startDate.getTime()));
        const timestampStr = logDate.toISOString().replace('T', ' ').substring(0, 19);

        // Elegir consumidor con pesos (Ingeniería usa más, luego Marketing y Soporte, luego Ventas)
        let consumerId;
        const rand = Math.random();
        if (rand < 0.45) {
            consumerId = 'equipo-ingenieria';
        } else if (rand < 0.70) {
            consumerId = 'equipo-soporte';
        } else if (rand < 0.90) {
            consumerId = 'equipo-marketing';
        } else {
            consumerId = 'equipo-ventas';
        }

        const consumer = CONSUMERS.find(c => c.id === consumerId);
        const users = USER_NAMES[consumerId];
        const userName = users[Math.floor(Math.random() * users.length)];

        // Si ya está bloqueado, simulamos un intento de consulta bloqueado
        if (spendTracker[consumerId] >= consumer.budget) {
            if (!notificationThresholds[consumerId].blocked) {
                notificationThresholds[consumerId].blocked = true;
                const blockMessage = `${consumer.name}: presupuesto mensual agotado. Gastado $${spendTracker[consumerId].toFixed(4)} de $${consumer.budget.toFixed(2)}.`;
                await db.run(
                    `INSERT INTO notifications (consumer_id, level, message, channel, created_at)
                     VALUES (?, 'blocked', ?, 'ui', ?)`,
                    consumerId, blockMessage, timestampStr
                );
            }
            continue; // Se salta el log de auditoría exitoso
        }

        // Determinar método de enrutamiento y modelo destino
        let targetModelId;
        let requestedModel = null;
        let routingMethod;
        let routingReason;

        const currentRatio = spendTracker[consumerId] / consumer.budget;

        if (currentRatio >= 0.90) {
            // Guardrail crítico de presupuesto
            targetModelId = 'llama3.2:3b';
            routingMethod = 'budget_guardrail_critical';
            routingReason = 'Presupuesto crítico (>90%). Se fuerza el modelo de menor coste.';
        } else {
            // Decisión normal
            const methodRand = Math.random();
            if (methodRand < 0.4) {
                // Tarea simple -> llama3.2
                targetModelId = 'llama3.2:3b';
                routingMethod = 'default_low_cost';
                routingReason = 'Tarea simple o general. Priorizamos el modelo base de bajo coste.';
            } else if (methodRand < 0.7) {
                // Razonamiento -> mistral
                targetModelId = 'mistral:7b';
                routingMethod = 'quality_reasoning_keywords';
                routingReason = 'Prompt corto pero de razonamiento/código. Priorizamos calidad con Mistral.';
            } else if (methodRand < 0.85) {
                // Prompt largo -> llama3.2
                targetModelId = 'llama3.2:3b';
                routingMethod = 'cost_guardrail_long_prompt';
                routingReason = 'Prompt largo (>100 tokens estimados). Priorizamos el modelo de menor coste.';
            } else {
                // Solicitud manual
                targetModelId = Math.random() > 0.5 ? 'llama-3.1-8b-instant' : 'llama3.2:3b';
                requestedModel = targetModelId;
                routingMethod = 'manual_request_honored';
                routingReason = 'Se respeta el modelo solicitado por el cliente.';
            }
        }

        // Tokens
        let promptTokens, completionTokens;
        // Mayor probabilidad de ser una tarea pesada en ingeniería para superar el presupuesto y probar los guardrails
        let isHeavyJob = Math.random() < 0.08;
        if (consumerId === 'equipo-ingenieria' && Math.random() < 0.25) {
            isHeavyJob = true;
        }
        if (consumerId === 'equipo-soporte' && Math.random() < 0.15) {
            isHeavyJob = true;
        }

        if (isHeavyJob) {
            // Tarea muy pesada, consume millones de tokens
            promptTokens = Math.floor(Math.random() * 2000000) + 1500000; // 1.5M - 3.5M
            completionTokens = Math.floor(Math.random() * 2500000) + 1000000; // 1.0M - 3.5M
            
            // Ajustar el motivo para reflejar la tarea pesada
            if (targetModelId === 'mistral:7b') {
                routingReason = 'Auditoría completa de base de datos y optimización de código. Requiere razonamiento profundo.';
            } else if (targetModelId === 'llama3.2:3b') {
                if (routingMethod === 'budget_guardrail_critical') {
                    routingReason = 'Procesamiento masivo solicitado pero bloqueado por presupuesto crítico. Forzado a llama3.2.';
                } else {
                    routingMethod = 'cost_guardrail_long_prompt';
                    routingReason = 'Prompt masivo detectado. Enrutado a llama3.2 para contener costes.';
                }
            } else {
                routingReason = 'Carga por lotes de traducción de documentos técnicos.';
            }
        } else {
            // Tarea de tamaño medio/chat normal
            if (routingMethod === 'cost_guardrail_long_prompt') {
                promptTokens = Math.floor(Math.random() * 3000) + 1500; // 1.5k - 4.5k
                completionTokens = Math.floor(Math.random() * 4000) + 2000;
            } else {
                promptTokens = Math.floor(Math.random() * 1000) + 100; // 100 - 1100
                completionTokens = Math.floor(Math.random() * 1500) + 200;
            }
        }

        const modelRow = MODELS.find(m => m.model_id === targetModelId);
        let costInput = (promptTokens / 1_000_000) * modelRow.input_cost;
        let costOutput = (completionTokens / 1_000_000) * modelRow.output_cost;
        let totalCostUsd = costInput + costOutput;

        const remainingBeforeThis = consumer.budget - spendTracker[consumerId];
        
        // Si el coste total de esta petición excede el presupuesto restante, 
        // reducimos los tokens de esta petición para que encaje exactamente o quede justo en el límite
        if (totalCostUsd > remainingBeforeThis) {
            const factor = remainingBeforeThis / totalCostUsd;
            promptTokens = Math.max(1, Math.floor(promptTokens * factor));
            completionTokens = Math.max(1, Math.floor(completionTokens * factor));
            
            costInput = (promptTokens / 1_000_000) * modelRow.input_cost;
            costOutput = (completionTokens / 1_000_000) * modelRow.output_cost;
            totalCostUsd = costInput + costOutput;
        }

        // Ahorro
        let estimatedSavingsUsd = 0;
        if (targetModelId !== BASELINE_MODEL_ID) {
            const baselineCost = (promptTokens / 1_000_000) * baselineModel.input_cost + (completionTokens / 1_000_000) * baselineModel.output_cost;
            estimatedSavingsUsd = Math.max(0, baselineCost - totalCostUsd);
        }

        // Registrar
        await db.run(
            `INSERT INTO audit_logs (
                consumer_id, user_name, requested_model, target_model,
                prompt_tokens, completion_tokens, total_cost_usd, estimated_savings_usd,
                routing_method, routing_reason, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            consumerId, userName, requestedModel, targetModelId,
            promptTokens, completionTokens, totalCostUsd, estimatedSavingsUsd,
            routingMethod, routingReason, timestampStr
        );

        // Actualizar spend local
        spendTracker[consumerId] += totalCostUsd;
        const newRatio = spendTracker[consumerId] / consumer.budget;
        const remainingBudgetAfterThis = consumer.budget - spendTracker[consumerId];

        // Comprobar notificaciones
        if (remainingBudgetAfterThis <= 0.50 && remainingBudgetAfterThis > 0 && !notificationThresholds[consumerId].critical) {
            notificationThresholds[consumerId].critical = true;
            const msg = `⚠️ ¡Atención! Se están agotando los tokens de tu presupuesto. Quedan menos de $0.50 USD disponibles ($${remainingBudgetAfterThis.toFixed(4)} restantes).`;
            await db.run(
                `INSERT INTO notifications (consumer_id, level, message, channel, created_at)
                 VALUES (?, 'critical', ?, 'ui', ?)`,
                consumerId, msg, timestampStr
            );
        } else if (newRatio >= 0.80 && !notificationThresholds[consumerId].warning) {
            notificationThresholds[consumerId].warning = true;
            const msg = `${consumer.name} ha usado el ${Math.round(newRatio * 100)}% de su presupuesto mensual ($${spendTracker[consumerId].toFixed(4)} de $${consumer.budget.toFixed(2)}).`;
            await db.run(
                `INSERT INTO notifications (consumer_id, level, message, channel, created_at)
                 VALUES (?, 'warning', ?, 'ui', ?)`,
                consumerId, msg, timestampStr
            );
        }
    }

    // Actualizar consumos finales en la base de datos
    console.log('[SEED] Actualizando gasto acumulado de los equipos en la tabla consumers...');
    for (const consumerId of Object.keys(spendTracker)) {
        const finalSpend = spendTracker[consumerId];
        await db.run(
            `UPDATE consumers SET current_spend_usd = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            finalSpend, consumerId
        );
        console.log(` - ${consumerId}: $${finalSpend.toFixed(6)}`);
    }

    await db.close();
    console.log('[SEED] Base de datos poblada con éxito.');
}

seed().catch(err => {
    console.error('[SEED ERROR] Ha fallado la inserción de datos:', err);
    process.exit(1);
});
