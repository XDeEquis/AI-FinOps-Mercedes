const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

// Única fuente de verdad para la base de datos. Antes existían dos ficheros
// sqlite distintos (finops.db y finops.sqlite) porque proxy.js abría su propia
// conexión "a mano". Ahora todo el backend usa este módulo.
const DB_PATH = process.env.FINOPS_DB_PATH || path.join(__dirname, 'finops.db');

let dbPromise;

function getDb() {
    if (!dbPromise) {
        dbPromise = open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });
    }
    return dbPromise;
}

// Mapeo departamento (frontend) -> consumidor FinOps (backend).
// Debe coincidir exactamente con DEPARTMENT_TO_CONSUMER en el frontend.
const DEFAULT_CONSUMERS = [
    { id: 'equipo-marketing', name: 'Equipo Marketing', department: 'marketing', monthly_budget_usd: 5.0 },
    { id: 'equipo-ingenieria', name: 'Equipo Ingeniería', department: 'engineering', monthly_budget_usd: 5.0 },
    { id: 'equipo-ventas', name: 'Equipo Ventas', department: 'sales', monthly_budget_usd: 5.0 },
    { id: 'equipo-soporte', name: 'Equipo Soporte', department: 'support', monthly_budget_usd: 5.0 }
];

// Tarifas y endpoints tomados literalmente de las bases del hackathon (.cursorrules / material/README.md).
const DEFAULT_MODELS = [
    { model_id: 'llama3.2:3b', provider: 'Provider A (Ollama local)', input_cost_per_million: 0.06, output_cost_per_million: 0.06, base_url: 'http://127.0.0.1:11434/v1' },
    { model_id: 'mistral:7b', provider: 'Provider B (Ollama local)', input_cost_per_million: 0.24, output_cost_per_million: 0.24, base_url: 'http://127.0.0.1:11435/v1' },
    { model_id: 'llama-3.1-8b-instant', provider: 'Provider C (Groq cloud)', input_cost_per_million: 0.05, output_cost_per_million: 0.08, base_url: 'https://api.groq.com/openai/v1' }
];

async function initializeDatabase() {
    const db = await getDb();

    await db.exec(`
        PRAGMA foreign_keys = ON;

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
            requested_model TEXT,
            target_model TEXT NOT NULL,
            prompt_tokens INTEGER NOT NULL CHECK (prompt_tokens >= 0),
            completion_tokens INTEGER NOT NULL CHECK (completion_tokens >= 0),
            total_cost_usd REAL NOT NULL CHECK (total_cost_usd >= 0),
            routing_method TEXT NOT NULL,
            routing_reason TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (consumer_id) REFERENCES consumers(id),
            FOREIGN KEY (target_model) REFERENCES models(model_id)
        );
    `);

    for (const model of DEFAULT_MODELS) {
        await db.run(
            `INSERT OR IGNORE INTO models (model_id, provider, input_cost_per_million, output_cost_per_million, base_url, is_active)
             VALUES (?, ?, ?, ?, ?, 1)`,
            model.model_id, model.provider, model.input_cost_per_million, model.output_cost_per_million, model.base_url
        );
    }

    for (const consumer of DEFAULT_CONSUMERS) {
        await db.run(
            `INSERT OR IGNORE INTO consumers (id, name, department, monthly_budget_usd, current_spend_usd)
             VALUES (?, ?, ?, ?, 0)`,
            consumer.id, consumer.name, consumer.department, consumer.monthly_budget_usd
        );
    }
}

async function getConsumerById(consumerId) {
    const db = await getDb();
    return db.get('SELECT * FROM consumers WHERE id = ?', consumerId);
}

async function getModelById(modelId) {
    const db = await getDb();
    return db.get('SELECT * FROM models WHERE model_id = ? AND is_active = 1', modelId);
}

async function listActiveModels() {
    const db = await getDb();
    return db.all('SELECT * FROM models WHERE is_active = 1 ORDER BY input_cost_per_million ASC');
}

async function recordUsageAndUpdateSpend({
    consumerId,
    requestedModel,
    targetModel,
    promptTokens,
    completionTokens,
    totalCostUsd,
    routingMethod,
    routingReason
}) {
    const db = await getDb();

    await db.exec('BEGIN TRANSACTION');
    try {
        await db.run(
            `INSERT INTO audit_logs (
                consumer_id, requested_model, target_model,
                prompt_tokens, completion_tokens, total_cost_usd,
                routing_method, routing_reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            consumerId, requestedModel || null, targetModel,
            promptTokens, completionTokens, totalCostUsd,
            routingMethod, routingReason
        );

        await db.run(
            `UPDATE consumers
             SET current_spend_usd = current_spend_usd + ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            totalCostUsd, consumerId
        );

        await db.exec('COMMIT');
    } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
    }
}

async function getConsumerSummary(consumerId) {
    const db = await getDb();
    return db.get(
        `SELECT
            c.id,
            c.name,
            c.department,
            c.monthly_budget_usd,
            c.current_spend_usd,
            COALESCE(COUNT(a.id), 0) AS requests_count,
            COALESCE(SUM(a.prompt_tokens), 0) AS total_prompt_tokens,
            COALESCE(SUM(a.completion_tokens), 0) AS total_completion_tokens
         FROM consumers c
         LEFT JOIN audit_logs a ON a.consumer_id = c.id
         WHERE c.id = ?
         GROUP BY c.id`,
        consumerId
    );
}

async function setConsumerSpend(consumerId, currentSpendUsd) {
    const db = await getDb();
    await db.run(
        `UPDATE consumers SET current_spend_usd = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        currentSpendUsd, consumerId
    );
    return getConsumerById(consumerId);
}

async function getFlowDashboardData() {
    const db = await getDb();

    const overview = await db.get(`
        SELECT
            COALESCE(COUNT(a.id), 0) AS total_requests,
            COALESCE(SUM(a.prompt_tokens), 0) AS total_prompt_tokens,
            COALESCE(SUM(a.completion_tokens), 0) AS total_completion_tokens,
            COALESCE(SUM(a.total_cost_usd), 0) AS total_cost_usd,
            COALESCE(AVG(a.total_cost_usd), 0) AS avg_cost_per_request,
            COALESCE(SUM(c.monthly_budget_usd), 0) AS total_monthly_budget_usd,
            COALESCE(SUM(c.current_spend_usd), 0) AS current_spend_usd
        FROM consumers c
        LEFT JOIN audit_logs a ON a.consumer_id = c.id
    `);

    const consumers = await db.all(`
        SELECT
            c.id,
            c.name,
            c.department,
            c.monthly_budget_usd,
            c.current_spend_usd,
            MAX(c.monthly_budget_usd - c.current_spend_usd, 0) AS remaining_budget_usd,
            CASE
                WHEN c.monthly_budget_usd > 0 THEN c.current_spend_usd / c.monthly_budget_usd
                ELSE 1
            END AS budget_usage_ratio,
            COALESCE(COUNT(a.id), 0) AS requests_count,
            COALESCE(SUM(a.prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(a.completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(a.total_cost_usd), 0) AS tracked_cost_usd
        FROM consumers c
        LEFT JOIN audit_logs a ON a.consumer_id = c.id
        GROUP BY c.id
        ORDER BY c.current_spend_usd DESC
    `);

    const modelUsage = await db.all(`
        SELECT
            a.target_model AS model_id,
            m.provider,
            m.input_cost_per_million,
            m.output_cost_per_million,
            COUNT(a.id) AS requests_count,
            COALESCE(SUM(a.prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(a.completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(a.total_cost_usd), 0) AS total_cost_usd
        FROM audit_logs a
        LEFT JOIN models m ON m.model_id = a.target_model
        GROUP BY a.target_model
        ORDER BY total_cost_usd DESC
    `);

    const routingUsage = await db.all(`
        SELECT
            routing_method,
            COUNT(*) AS requests_count,
            COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd
        FROM audit_logs
        GROUP BY routing_method
        ORDER BY requests_count DESC
    `);

    const dailySpend = await db.all(`
        SELECT
            DATE(created_at) AS day,
            COUNT(*) AS requests_count,
            COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd
        FROM audit_logs
        GROUP BY DATE(created_at)
        ORDER BY day ASC
    `);

    const recentRequests = await db.all(`
        SELECT
            a.id,
            a.created_at,
            a.consumer_id,
            c.name AS consumer_name,
            c.department,
            a.requested_model,
            a.target_model,
            a.routing_method,
            a.routing_reason,
            a.prompt_tokens,
            a.completion_tokens,
            a.total_cost_usd
        FROM audit_logs a
        LEFT JOIN consumers c ON c.id = a.consumer_id
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT 50
    `);

    const expensiveModelUsage = modelUsage.find((row) => row.model_id === 'mistral:7b');
    const cheapModel = await getModelById('llama3.2:3b');
    const expensiveModel = await getModelById('mistral:7b');

    const estimatedAvoidableCostUsd = expensiveModelUsage && cheapModel && expensiveModel
        ? ((expensiveModelUsage.prompt_tokens / 1_000_000) * (expensiveModel.input_cost_per_million - cheapModel.input_cost_per_million))
            + ((expensiveModelUsage.completion_tokens / 1_000_000) * (expensiveModel.output_cost_per_million - cheapModel.output_cost_per_million))
        : 0;

    const daysWithUsage = dailySpend.length || 1;
    const projectedMonthlySpendUsd = (overview.total_cost_usd / daysWithUsage) * 30;

    return {
        generated_at: new Date().toISOString(),
        overview: {
            ...overview,
            remaining_budget_usd: Math.max(0, overview.total_monthly_budget_usd - overview.current_spend_usd),
            budget_usage_ratio: overview.total_monthly_budget_usd > 0
                ? overview.current_spend_usd / overview.total_monthly_budget_usd
                : 0,
            projected_monthly_spend_usd: projectedMonthlySpendUsd,
            estimated_avoidable_cost_usd: Math.max(0, estimatedAvoidableCostUsd)
        },
        consumers,
        model_usage: modelUsage,
        routing_usage: routingUsage,
        daily_spend: dailySpend,
        recent_requests: recentRequests
    };
}

module.exports = {
    initializeDatabase,
    getConsumerById,
    getModelById,
    listActiveModels,
    recordUsageAndUpdateSpend,
    getConsumerSummary,
    setConsumerSpend,
    getFlowDashboardData,
    DEFAULT_CONSUMERS,
    DEFAULT_MODELS
};
