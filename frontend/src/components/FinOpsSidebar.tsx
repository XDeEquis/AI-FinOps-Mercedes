import { motion } from 'framer-motion'
import { Wallet, Bot } from 'lucide-react'
import { translations } from '../i18n'
import type { Language } from '../i18n'
import type { UserSession } from '../App'
import type { ReactNode } from 'react'

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
  const percentage = Math.min((spent / budget) * 100, 100)
  const isWarning = percentage > 80

  const getDeptLabel = () => {
    switch (user.department) {
      case 'marketing': return t.deptMarketing;
      case 'engineering': return t.deptEngineering;
      case 'sales': return t.deptSales;
      case 'support': return t.deptSupport;
      default: return user.department;
    }
  }

  const getDeptModels = () => {
    switch (user.department) {
      case 'engineering':
        return [
          { name: "Ollama (mistral:7b)", isServer: true, cost: "$0.15 / 1M tokens", isPrimary: true },
          { name: "Groq (llama-3.1-8b)", isServer: false, cost: "$0.05 / 1M tokens", isPrimary: false }
        ];
      case 'marketing':
        return [
          { name: "Ollama (llama3.2:3b)", isServer: true, cost: "$0.06 / 1M tokens", isPrimary: true },
          { name: "Ollama (mistral:7b)", isServer: true, cost: "$0.15 / 1M tokens", isPrimary: false }
        ];
      case 'sales':
        return [
          { name: "Groq (llama-3.1-8b)", isServer: false, cost: "$0.05 / 1M tokens", isPrimary: true },
          { name: "Ollama (llama3.2:3b)", isServer: true, cost: "$0.06 / 1M tokens", isPrimary: false }
        ];
      case 'support':
      default:
        return [
          { name: "Ollama (llama3.2:3b)", isServer: true, cost: "$0.06 / 1M tokens", isPrimary: true },
          { name: "Groq (llama-3.1-8b)", isServer: false, cost: "$0.05 / 1M tokens", isPrimary: false }
        ];
    }
  }

  const models = getDeptModels()

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
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Wallet size={18} /> {t.budgetUsage}
          </span>
          <span style={{ fontWeight: 600, color: isWarning ? '#ff4d4f' : 'inherit' }}>
            ${spent.toFixed(4)} / ${budget.toFixed(2)}
          </span>
        </div>
        
        <div style={{ background: 'var(--icon-bg)', height: '10px', borderRadius: '0px', overflow: 'hidden' }}>
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: `${percentage}%` }}
            transition={{ type: 'spring', stiffness: 50, damping: 15 }}
            style={{ 
              height: '100%', 
              background: isWarning ? '#ff4d4f' : 'var(--user-msg-bg)',
              borderRadius: '0px',
              boxShadow: isWarning ? '0 0 10px rgba(255, 77, 79, 0.5)' : 'none'
            }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h3 style={{ margin: '0 0 4px 0', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '1.2px', color: 'var(--text-secondary)', fontWeight: 600 }}>{t.activeModels}</h3>
        
        {models.map((model, idx) => (
          <motion.div 
            key={idx}
            whileHover={{ scale: 1.02 }} 
            className="glass-panel" 
            style={{ 
              padding: '20px', 
              border: model.isPrimary ? '1px solid var(--accent-primary)' : '1px solid var(--panel-border)', 
              background: model.isPrimary ? 'var(--accent-glow)' : 'transparent' 
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              <Bot size={20} color="var(--accent-primary)" />
              <strong style={{ fontSize: '1rem', fontWeight: 500 }}>{model.name}</strong>
            </div>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t.cost} {model.cost}</p>
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
