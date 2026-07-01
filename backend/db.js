const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

// Única fuente de verdad para la base de datos. Todo el backend usa este módulo
// (nunca abrir sqlite3.Database directamente en otro archivo).
const DB_PATH = process.env.FINOPS_DB_PATH || path.join(__dirname, 'finops.db');

// Presupuesto mensual por defecto para cada equipo (USD). Configurable por
// variable de entorno para la demo, y ajustable en caliente por equipo con
// PATCH /v1/consumers/:id/budget (ver routes/proxy.js).
const DEFAULT_BUDGET_USD = Number(process.env.FINOPS_DEFAULT_BUDGET_USD) || 5.0;

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
// Debe coincidir exactamente con DEPARTMENT_TO_CONSUMER en frontend/src/consumers.ts.
const DEFAULT_CONSUMERS = [
    { id: 'equipo-marketing', name: 'Equipo Marketing', department: 'marketing', monthly_budget_usd: DEFAULT_BUDGET_USD },
    { id: 'equipo-ingenieria', name: 'Equipo Ingeniería', department: 'engineering', monthly_budget_usd: DEFAULT_BUDGET_USD },
    { id: 'equipo-ventas', name: 'Equipo Ventas', department: 'sales', monthly_budget_usd: DEFAULT_BUDGET_USD },
    { id: 'equipo-soporte', name: 'Equipo Soporte', department: 'support', monthly_budget_usd: DEFAULT_BUDGET_USD }
];

// Tarifas y endpoints tomados literalmente de las bases del hackathon (.cursorrules / material/README.md).
// Solo usamos proveedores locales (Ollama): Groq queda excluido a propósito.
const DEFAULT_MODELS = [
    { model_id: 'llama3.2:3b', provider: 'Provider A (Ollama local)', input_cost_per_million: 0.06, output_cost_per_million: 0.06, base_url: 'http://127.0.0.1:11434/v1' },
    { model_id: 'mistral:7b', provider: 'Provider B (Ollama local)', input_cost_per_million: 0.24, output_cost_per_million: 0.24, base_url: 'http://127.0.0.1:11435/v1' }
];

// Modelos que ya no se ofrecen. Si existían en una BD previa, los desactivamos
// para que desaparezcan del catálogo (GET /v1/models) sin romper el histórico
// de audit_logs que pudiera referenciarlos.
const RETIRED_MODEL_IDS = ['llama-3.1-8b-instant'];

// El modelo más caro del catálogo se usa como "línea base" para calcular
// cuánto se ahorró al enrutar a un modelo más barato en cada request.
const BASELINE_MODEL_ID = 'mistral:7b';

async function columnExists(db, table, column) {
    const columns = await db.all(`PRAGMA table_info(${table})`);
    return columns.some((col) => col.name === column);
}

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

    // Migraciones idempotentes: si la BD ya existía de una versión anterior,
    // añadimos las columnas nuevas sin perder datos históricos.
    const hasSavingsColumn = await columnExists(db, 'audit_logs', 'estimated_savings_usd');
    if (!hasSavingsColumn) {
        await db.exec(`ALTER TABLE audit_logs ADD COLUMN estimated_savings_usd REAL NOT NULL DEFAULT 0`);
    }

    const hasUserNameColumn = await columnExists(db, 'audit_logs', 'user_name');
    if (!hasUserNameColumn) {
        await db.exec(`ALTER TABLE audit_logs ADD COLUMN user_name TEXT`);
    }

    for (const model of DEFAULT_MODELS) {
        await db.run(
            `INSERT OR IGNORE INTO models (model_id, provider, input_cost_per_million, output_cost_per_million, base_url, is_active)
             VALUES (?, ?, ?, ?, ?, 1)`,
            model.model_id, model.provider, model.input_cost_per_million, model.output_cost_per_million, model.base_url
        );
    }

    // Desactivamos modelos retirados (p. ej. Groq) si estaban en una BD previa.
    for (const retiredId of RETIRED_MODEL_IDS) {
        await db.run(`UPDATE models SET is_active = 0 WHERE model_id = ?`, retiredId);
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

async function listConsumers() {
    const db = await getDb();
    return db.all('SELECT * FROM consumers ORDER BY name ASC');
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
    userName,
    requestedModel,
    targetModel,
    promptTokens,
    completionTokens,
    totalCostUsd,
    estimatedSavingsUsd,
    routingMethod,
    routingReason
}) {
    const db = await getDb();

    await db.exec('BEGIN TRANSACTION');
    try {
        await db.run(
            `INSERT INTO audit_logs (
                consumer_id, user_name, requested_model, target_model,
                prompt_tokens, completion_tokens, total_cost_usd, estimated_savings_usd,
                routing_method, routing_reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            consumerId, userName || null, requestedModel || null, targetModel,
            promptTokens, completionTokens, totalCostUsd, estimatedSavingsUsd || 0,
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
            COALESCE(SUM(a.completion_tokens), 0) AS total_completion_tokens,
            COALESCE(SUM(a.estimated_savings_usd), 0) AS total_savings_usd
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

async function setConsumerBudget(consumerId, monthlyBudgetUsd) {
    const db = await getDb();
    await db.run(
        `UPDATE consumers SET monthly_budget_usd = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        monthlyBudgetUsd, consumerId
    );
    return getConsumerById(consumerId);
}

async function insertNotification({ consumerId, level, message, channel = 'ui' }) {
    const db = await getDb();
    await db.run(
        `INSERT INTO notifications (consumer_id, level, message, channel) VALUES (?, ?, ?, ?)`,
        consumerId, level, message, channel
    );
}

async function listNotifications({ consumerId, limit = 50 } = {}) {
    const db = await getDb();
    if (consumerId) {
        return db.all(
            `SELECT n.*, c.name AS consumer_name
             FROM notifications n
             LEFT JOIN consumers c ON c.id = n.consumer_id
             WHERE n.consumer_id = ?
             ORDER BY n.created_at DESC, n.id DESC
             LIMIT ?`,
            consumerId, limit
        );
    }
    return db.all(
        `SELECT n.*, c.name AS consumer_name
         FROM notifications n
         LEFT JOIN consumers c ON c.id = n.consumer_id
         ORDER BY n.created_at DESC, n.id DESC
         LIMIT ?`,
        limit
    );
}

async function getFlowDashboardData() {
    const db = await getDb();

    // OJO: total_monthly_budget_usd y current_spend_usd se calculan a partir de
    // `consumers` en solitario (sin JOIN a audit_logs). Un LEFT JOIN aquí
    // duplicaría cada fila de consumers una vez por cada audit_log asociado,
    // inflando esos SUM() de forma silenciosa (bug detectado en producción).
    const consumerTotals = await db.get(`
        SELECT
            COALESCE(SUM(monthly_budget_usd), 0) AS total_monthly_budget_usd,
            COALESCE(SUM(current_spend_usd), 0) AS current_spend_usd
        FROM consumers
    `);

    const auditTotals = await db.get(`
        SELECT
            COALESCE(COUNT(id), 0) AS total_requests,
            COALESCE(SUM(prompt_tokens), 0) AS total_prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS total_completion_tokens,
            COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd,
            COALESCE(SUM(estimated_savings_usd), 0) AS total_savings_usd,
            COALESCE(AVG(total_cost_usd), 0) AS avg_cost_per_request
        FROM audit_logs
    `);

    const overview = { ...consumerTotals, ...auditTotals };

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
            COALESCE(SUM(a.total_cost_usd), 0) AS tracked_cost_usd,
            COALESCE(SUM(a.estimated_savings_usd), 0) AS savings_usd
        FROM consumers c
        LEFT JOIN audit_logs a ON a.consumer_id = c.id
        GROUP BY c.id
        ORDER BY c.current_spend_usd DESC
    `);

    // Contribución individual de cada persona dentro de su equipo (para el
    // desglose "quién ha gastado qué" que pide el dashboard).
    const userUsage = await db.all(`
        SELECT
            a.consumer_id,
            c.name AS consumer_name,
            COALESCE(NULLIF(TRIM(a.user_name), ''), 'Sin identificar') AS user_name,
            COUNT(a.id) AS requests_count,
            COALESCE(SUM(a.prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(a.completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(a.total_cost_usd), 0) AS total_cost_usd,
            COALESCE(SUM(a.estimated_savings_usd), 0) AS total_savings_usd
        FROM audit_logs a
        LEFT JOIN consumers c ON c.id = a.consumer_id
        GROUP BY a.consumer_id, user_name
        ORDER BY c.name ASC, total_cost_usd DESC
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
            COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd,
            COALESCE(SUM(estimated_savings_usd), 0) AS total_savings_usd
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

    const hourlySpend = await db.all(`
        SELECT
            strftime('%Y-%m-%d %H:00', created_at) AS hour,
            COUNT(*) AS requests_count,
            COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd
        FROM audit_logs
        GROUP BY hour
        ORDER BY hour ASC
    `);

    // Granularidad por request: siempre disponible desde la 2ª llamada,
    // clave para poder mostrar la proyección ML durante la demo en vivo
    // aunque todavía no haya varios días de histórico.
    const requestSequence = await db.all(`
        SELECT
            a.id,
            a.created_at,
            a.consumer_id,
            a.target_model,
            a.routing_method,
            a.prompt_tokens,
            a.completion_tokens,
            a.total_cost_usd,
            a.estimated_savings_usd
        FROM audit_logs a
        ORDER BY a.id ASC
    `);

    const recentRequests = await db.all(`
        SELECT
            a.id,
            a.created_at,
            a.consumer_id,
            c.name AS consumer_name,
            c.department,
            a.user_name,
            a.requested_model,
            a.target_model,
            a.routing_method,
            a.routing_reason,
            a.prompt_tokens,
            a.completion_tokens,
            a.total_cost_usd,
            a.estimated_savings_usd
        FROM audit_logs a
        LEFT JOIN consumers c ON c.id = a.consumer_id
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT 100
    `);

    const recentNotifications = await listNotifications({ limit: 30 });

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
            projected_monthly_spend_usd: projectedMonthlySpendUsd
        },
        consumers,
        user_usage: userUsage,
        model_usage: modelUsage,
        routing_usage: routingUsage,
        daily_spend: dailySpend,
        hourly_spend: hourlySpend,
        request_sequence: requestSequence,
        recent_requests: recentRequests,
        notifications: recentNotifications
    };
}

// ──────────────────────── SEED DE DEMO (datos hardcodeados) ────────────────────────
// Generador pseudoaleatorio determinista: misma semilla => mismos datos siempre,
// para que la demo sea reproducible ("datos perfectos" y estables).
function mulberry32(seed) {
    return function () {
        seed |= 0;
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function formatTimestamp(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function pickWeighted(items, rand) {
    const total = items.reduce((acc, it) => acc + it.weight, 0);
    let r = rand() * total;
    for (const it of items) {
        r -= it.weight;
        if (r <= 0) return it;
    }
    return items[items.length - 1];
}

/**
 * Rellena la base de datos con un histórico realista de 14 días para la demo:
 * varios equipos, varias personas por equipo, decisiones de routing coherentes,
 * y presupuestos ajustados para dejar un equipo BLOQUEADO (>100%), otro CRÍTICO
 * (~93%), uno en aviso y otro holgado. Es idempotente: borra y regenera.
 */
async function seedDemoData() {
    await initializeDatabase();
    const db = await getDb();
    const rand = mulberry32(20260701);

    const rates = {};
    for (const m of DEFAULT_MODELS) rates[m.model_id] = m;
    const baseline = rates[BASELINE_MODEL_ID];

    // targetRatio = gasto / presupuesto deseado al final del seed.
    // Volúmenes altos (cargas corporativas con contexto largo) para que el gasto
    // y los presupuestos se lean en dólares y no en céntimos.
    const teams = [
        { id: 'equipo-ingenieria', users: ['Alejandro', 'Laura', 'Marc', 'Nuria'], perDay: [30, 50], targetRatio: 0.62 },
        { id: 'equipo-marketing', users: ['Sofía', 'Diego', 'Elena'], perDay: [25, 45], targetRatio: 1.08 },
        { id: 'equipo-ventas', users: ['Carlos', 'Marta', 'Iván'], perDay: [28, 48], targetRatio: 0.93 },
        { id: 'equipo-soporte', users: ['Paula', 'Hugo'], perDay: [12, 25], targetRatio: 0.45 }
    ];

    const routingChoices = [
        { method: 'default_low_cost', model: 'llama3.2:3b', reason: 'Tarea simple o general. Priorizamos el modelo base de bajo coste.', weight: 5 },
        { method: 'quality_reasoning_keywords', model: 'mistral:7b', reason: 'Prompt corto pero de razonamiento/código. Priorizamos calidad con Mistral.', weight: 3 },
        { method: 'cost_guardrail_long_prompt', model: 'llama3.2:3b', reason: 'Prompt largo. Priorizamos el modelo de menor coste.', weight: 2 }
    ];

    const DAYS = 14;
    const now = Date.now();

    await db.exec('BEGIN TRANSACTION');
    try {
        await db.run('DELETE FROM audit_logs');
        await db.run('DELETE FROM notifications');
        await db.run('UPDATE consumers SET current_spend_usd = 0');

        const spendByTeam = {};

        for (const team of teams) {
            spendByTeam[team.id] = 0;
            for (let d = DAYS - 1; d >= 0; d--) {
                const count = team.perDay[0] + Math.floor(rand() * (team.perDay[1] - team.perDay[0] + 1));
                for (let i = 0; i < count; i++) {
                    const choice = pickWeighted(routingChoices, rand);
                    const model = rates[choice.model];

                    const promptTokens = choice.method === 'cost_guardrail_long_prompt'
                        ? 150000 + Math.floor(rand() * 110000)
                        : 90000 + Math.floor(rand() * 60000);
                    const completionTokens = Math.max(300, Math.floor(promptTokens * (0.12 + rand() * 0.08)));

                    const cost = (promptTokens / 1_000_000) * model.input_cost_per_million +
                        (completionTokens / 1_000_000) * model.output_cost_per_million;

                    let savings = 0;
                    if (choice.model !== BASELINE_MODEL_ID) {
                        const baselineCost = (promptTokens / 1_000_000) * baseline.input_cost_per_million +
                            (completionTokens / 1_000_000) * baseline.output_cost_per_million;
                        savings = Math.max(0, baselineCost - cost);
                    }

                    const user = team.users[Math.floor(rand() * team.users.length)];
                    const dt = new Date(now - d * 86400000);
                    dt.setHours(8 + Math.floor(rand() * 11), Math.floor(rand() * 60), Math.floor(rand() * 60), 0);

                    await db.run(
                        `INSERT INTO audit_logs (
                            consumer_id, user_name, requested_model, target_model,
                            prompt_tokens, completion_tokens, total_cost_usd, estimated_savings_usd,
                            routing_method, routing_reason, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        team.id, user, null, choice.model,
                        promptTokens, completionTokens, cost, savings,
                        choice.method, choice.reason, formatTimestamp(dt)
                    );

                    spendByTeam[team.id] += cost;
                }
            }
        }

        // Presupuesto derivado del gasto real para clavar el ratio objetivo.
        for (const team of teams) {
            const spend = spendByTeam[team.id];
            const budget = Math.max(0.01, Number((spend / team.targetRatio).toFixed(2)));
            await db.run(
                'UPDATE consumers SET monthly_budget_usd = ?, current_spend_usd = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                budget, spend, team.id
            );
        }

        await db.exec('COMMIT');
    } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
    }

    // Notificaciones históricas coherentes con el estado final de cada equipo.
    for (const team of teams) {
        const c = await getConsumerById(team.id);
        const ratio = c.monthly_budget_usd > 0 ? c.current_spend_usd / c.monthly_budget_usd : 0;
        if (ratio >= 1) {
            await insertNotification({ consumerId: c.id, level: 'blocked', message: `${c.name}: presupuesto mensual agotado. Gastado $${c.current_spend_usd.toFixed(4)} de $${c.monthly_budget_usd.toFixed(2)}. Nuevas peticiones bloqueadas.` });
        } else if (ratio >= 0.9) {
            await insertNotification({ consumerId: c.id, level: 'critical', message: `${c.name} ha superado el ${Math.round(ratio * 100)}% de su presupuesto. Enrutando solo al modelo más barato.` });
        } else if (ratio >= 0.8) {
            await insertNotification({ consumerId: c.id, level: 'warning', message: `${c.name} ha usado el ${Math.round(ratio * 100)}% de su presupuesto mensual.` });
        }
    }

    return { teams: teams.length };
}

module.exports = {
    initializeDatabase,
    seedDemoData,
    getConsumerById,
    listConsumers,
    getModelById,
    listActiveModels,
    recordUsageAndUpdateSpend,
    getConsumerSummary,
    setConsumerSpend,
    setConsumerBudget,
    insertNotification,
    listNotifications,
    getFlowDashboardData,
    DEFAULT_CONSUMERS,
    DEFAULT_MODELS,
    DEFAULT_BUDGET_USD,
    BASELINE_MODEL_ID
};
