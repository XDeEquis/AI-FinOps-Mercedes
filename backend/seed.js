require('dotenv').config();
const db = require('./db');

// Script de datos de demo: `npm run seed` desde la carpeta backend.
// Regenera un histórico realista con equipos en distintos niveles de consumo
// sin exceder el 100% de presupuesto. Es idempotente (borra y vuelve a crear).
(async () => {
    try {
        console.log('[SEED] Generando datos de demo...');
        const result = await db.seedDemoData();

        const consumers = await db.listConsumers();
        console.log('[SEED] Estado final por equipo:');
        for (const c of consumers) {
            const ratio = c.monthly_budget_usd > 0 ? (c.current_spend_usd / c.monthly_budget_usd) * 100 : 0;
            console.log(
                `  - ${c.name.padEnd(20)} gasto $${c.current_spend_usd.toFixed(4)} / ` +
                `$${c.monthly_budget_usd.toFixed(2)}  (${ratio.toFixed(1)}%)`
            );
        }
        console.log(`[SEED] Completado (${result.teams} equipos).`);
        process.exit(0);
    } catch (error) {
        console.error('[SEED ERROR]', error);
        process.exit(1);
    }
})();
