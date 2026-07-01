import { motion } from 'framer-motion'
import { Wallet, Activity, Zap, Server } from 'lucide-react'
import { translations } from '../i18n'
import type { Language } from '../i18n'

export function FinOpsSidebar({ budget, spent, lang }: { budget: number, spent: number, lang: Language }) {
  const t = translations[lang]
  const percentage = Math.min((spent / budget) * 100, 100)
  const isWarning = percentage > 80

  return (
    <motion.div 
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className="glass-panel"
      style={{ 
        width: '340px', 
        padding: '32px',
        display: 'flex',
        flexDirection: 'column',
        gap: '40px'
      }}
    >
      <div>
        <h2 style={{ margin: '0 0 8px 0', fontSize: '1.4rem', fontWeight: 600, letterSpacing: '-0.5px' }}>AI FinOps</h2>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{t.team} <strong style={{color: 'var(--text-primary)', fontWeight: 500}}>Marketing</strong></p>
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Wallet size={18} /> {t.budgetUsage}
          </span>
          <span style={{ fontWeight: 600, color: isWarning ? '#ff4d4f' : 'inherit' }}>
            ${spent.toFixed(4)} / ${budget.toFixed(2)}
          </span>
        </div>
        
        <div style={{ background: 'var(--icon-bg)', height: '10px', borderRadius: '6px', overflow: 'hidden' }}>
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: `${percentage}%` }}
            transition={{ type: 'spring', stiffness: 50, damping: 15 }}
            style={{ 
              height: '100%', 
              background: isWarning ? '#ff4d4f' : 'var(--user-msg-bg)',
              borderRadius: '6px',
              boxShadow: isWarning ? '0 0 10px rgba(255, 77, 79, 0.5)' : 'none'
            }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h3 style={{ margin: '0 0 4px 0', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '1.2px', color: 'var(--text-secondary)', fontWeight: 600 }}>{t.activeModels}</h3>
        
        <motion.div whileHover={{ scale: 1.02 }} className="glass-panel" style={{ padding: '20px', border: '1px solid rgba(157, 78, 221, 0.4)', background: 'rgba(157, 78, 221, 0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <Server size={20} color="var(--accent-primary)" />
            <strong style={{ fontSize: '1rem', fontWeight: 500 }}>Ollama (llama3.2:3b)</strong>
          </div>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t.cost} $0.06 / 1M tokens</p>
        </motion.div>

        <motion.div whileHover={{ scale: 1.02 }} className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <Zap size={20} color="var(--accent-secondary)" />
            <strong style={{ fontSize: '1rem', fontWeight: 500 }}>Groq (llama-3.1-8b)</strong>
          </div>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t.cost} $0.05 / 1M tokens</p>
        </motion.div>
      </div>
      
    </motion.div>
  )
}
