import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Wallet, Bot } from 'lucide-react'
import { translations } from '../i18n'
import type { Language } from '../i18n'
import type { UserSession } from '../App'
import type { ReactNode } from 'react'
import { formatUsd, formatPct } from '../utils/format'

type ModelInfo = {
  model_id: string
  provider: string
  input_cost_per_million: number
  output_cost_per_million: number
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

export function FinOpsSidebar({
  budget,
  spent,
  lang,
  user,
  children
}: {
  budget: number,
  spent: number,
  lang: Language,
  user: UserSession,
  children?: ReactNode
}) {
  const t = translations[lang]
  const ratio = budget > 0 ? spent / budget : 0
  const isWarning = ratio >= 0.8
  const [models, setModels] = useState<ModelInfo[]>([])

  useEffect(() => {
    let cancelled = false
    // Catálogo de modelos y tarifas SIEMPRE viene del backend: es la única
    // fuente de verdad de precios (evita mostrar cifras inventadas/obsoletas).
    fetch(`${API_BASE_URL}/v1/models`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data?.data)) setModels(data.data)
      })
      .catch(() => { /* backend no disponible: sidebar sigue mostrando budget local */ })
    return () => { cancelled = true }
  }, [])

  const getDeptLabel = () => {
    switch (user.department) {
      case 'marketing': return t.deptMarketing;
      case 'engineering': return t.deptEngineering;
      case 'sales': return t.deptSales;
      case 'support': return t.deptSupport;
      default: return user.department;
    }
  }

  // Barra con ancho mínimo visible cuando hay gasto real, aunque sea
  // infinitesimal frente al presupuesto (evita el efecto "parece parado").
  const barWidth = spent > 0 ? Math.max(ratio * 100, 1.5) : 0

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className="glass-panel finops-sidebar"
      style={{
        width: '340px',
        padding: '32px',
        display: 'flex',
        flexDirection: 'column',
        gap: '40px',
        height: '100%',
        boxSizing: 'border-box'
      }}
    >
      <div>
        <h2 style={{ margin: '0 0 8px 0', fontSize: '1.4rem', fontWeight: 600, letterSpacing: '-0.5px' }}>{user.name}</h2>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{t.team} <strong style={{color: 'var(--text-primary)', fontWeight: 500}}>{getDeptLabel()}</strong></p>
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', gap: '8px' }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Wallet size={18} /> {t.budgetUsage}
          </span>
          <span style={{ fontWeight: 600, color: isWarning ? '#ff4d4f' : 'inherit', textAlign: 'right' }} title={`Uso: ${formatPct(ratio)}`}>
            ${formatUsd(spent)} / ${budget.toFixed(2)}
          </span>
        </div>

        <div
          role="progressbar"
          aria-valuenow={Math.round(ratio * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t.budgetUsage}
          style={{ background: 'var(--icon-bg)', height: '10px', borderRadius: '0px', overflow: 'hidden' }}
        >
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(barWidth, 100)}%` }}
            transition={{ type: 'spring', stiffness: 50, damping: 15 }}
            style={{
              height: '100%',
              background: isWarning ? '#ff4d4f' : 'var(--user-msg-bg)',
              borderRadius: '0px',
              boxShadow: isWarning ? '0 0 10px rgba(255, 77, 79, 0.5)' : 'none'
            }}
          />
        </div>
        <p style={{ margin: '6px 0 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          {formatPct(ratio)} {t.budgetUsage.toLowerCase()}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h3 style={{ margin: '0 0 4px 0', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '1.2px', color: 'var(--text-secondary)', fontWeight: 600 }}>{t.activeModels}</h3>

        {models.length === 0 && (
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>—</p>
        )}

        {models.map((model) => (
          <motion.div
            key={model.model_id}
            whileHover={{ scale: 1.02 }}
            className="glass-panel"
            style={{
              padding: '20px',
              border: '1px solid var(--panel-border)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              <Bot size={20} color="var(--accent-primary)" />
              <strong style={{ fontSize: '1rem', fontWeight: 500 }}>{model.model_id}</strong>
            </div>
            <p style={{ margin: '0 0 2px 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{model.provider}</p>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {t.cost} ${model.input_cost_per_million.toFixed(2)} / 1M in · ${model.output_cost_per_million.toFixed(2)} / 1M out
            </p>
          </motion.div>
        ))}
      </div>

      {/* Footer controls space */}
      <div style={{ marginTop: 'auto' }}>
        {children}
      </div>
    </motion.div>
  )
}
