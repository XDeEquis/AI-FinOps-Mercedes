import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Bot, User } from 'lucide-react'
import { translations } from '../i18n'
import type { Language } from '../i18n'
import type { UserSession } from '../App'
import { getConsumerId } from '../consumers'
import { formatUsd } from '../utils/format'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  model?: string
  cost?: number
  routingReason?: string
}

type ChatUsageUpdate = {
  currentSpend: number
  monthlyBudget: number
}

type AlertLevel = 'warning' | 'critical' | 'blocked'

type AlertBanner = {
  level: AlertLevel
  message: string
}

const ALERT_STYLES: Record<AlertLevel, { bg: string; border: string; icon: string }> = {
  warning: { bg: 'rgba(255, 193, 7, 0.15)', border: '#FFC107', icon: '⚠️' },
  critical: { bg: 'rgba(255, 107, 0, 0.15)', border: '#FF6B00', icon: '🟠' },
  blocked: { bg: 'rgba(208, 2, 27, 0.15)', border: '#D0021B', icon: '🛑' }
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

export function ChatWindow({
  onMessageSent,
  lang,
  user
}: {
  onMessageSent: (update: ChatUsageUpdate) => void
  lang: Language
  user: UserSession
}) {
  const t = translations[lang]
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'assistant', content: '', model: 'system', cost: 0 }
  ])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [alert, setAlert] = useState<AlertBanner | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  const handleSend = async () => {
    if (!input.trim()) return

    const prompt = input.trim()
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: prompt }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsTyping(true)

    const consumerId = getConsumerId(user.department)

    try {
      // Llamada real al AI FinOps Proxy. El backend decide el modelo,
      // calcula el coste y aplica presupuesto. El frontend solo pinta la respuesta.
      const response = await fetch(`${API_BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-consumer-id': consumerId,
          'x-user-name': user.name
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }]
        })
      })

      const data = await response.json()

      if (data?.alert) {
        setAlert(data.alert)
      }

      if (!response.ok) {
        if (typeof data?.finops?.current_spend_usd === 'number') {
          onMessageSent({
            currentSpend: data.finops.current_spend_usd,
            monthlyBudget: data.finops.monthly_budget_usd ?? 0
          })
        }
        throw new Error(data?.detail || data?.error || 'Error en el proxy FinOps')
      }

      const modelUsed = data?.model ?? 'desconocido'
      const assistantText = data?.choices?.[0]?.message?.content ?? t.mockResponse.replace('{model}', modelUsed)
      const cost = Number(data?.finops?.cost_usd ?? 0)

      onMessageSent({
        currentSpend: Number(data?.finops?.current_spend_usd ?? 0),
        monthlyBudget: Number(data?.finops?.monthly_budget_usd ?? 0)
      })

      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: assistantText,
        model: modelUsed,
        cost,
        routingReason: data?.finops?.routing_reason
      }])
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Error desconocido del proxy'
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `⚠️ ${msg}`
      }])
    } finally {
      setIsTyping(false)
    }
  }

  const displayMessages = messages.map(msg =>
    msg.id === '1' ? { ...msg, content: t.deptWelcome[user.department] } : msg
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="glass-panel chat-window"
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      <AnimatePresence>
        {alert && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{
              background: ALERT_STYLES[alert.level].bg,
              borderBottom: `2px solid ${ALERT_STYLES[alert.level].border}`,
              padding: '14px 32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px'
            }}
          >
            <span style={{ fontSize: '0.95rem', fontWeight: 500 }}>
              {ALERT_STYLES[alert.level].icon} {alert.message}
            </span>
            <button
              onClick={() => setAlert(null)}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--text-primary)', fontSize: '1.1rem', opacity: 0.6, lineHeight: 1
              }}
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="chat-messages" style={{
        flex: 1, overflowY: 'auto', padding: '32px',
        display: 'flex', flexDirection: 'column', gap: '24px', position: 'relative'
      }}>
        {/* Mercedes Benz Star Watermark */}
        <div className="chat-watermark">
          <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
            <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M 50,50 L 50,6 L 54.3,47.5 Z" fill="currentColor" />
            <path d="M 50,50 L 50,6 L 45.7,47.5 Z" fill="currentColor" style={{ opacity: 0.5 }} />
            <path d="M 50,50 L 88.1,72 L 54.3,47.5 Z" fill="currentColor" style={{ opacity: 0.5 }} />
            <path d="M 50,50 L 88.1,72 L 50,55 Z" fill="currentColor" />
            <path d="M 50,50 L 11.9,72 L 50,55 Z" fill="currentColor" style={{ opacity: 0.5 }} />
            <path d="M 50,50 L 11.9,72 L 45.7,47.5 Z" fill="currentColor" />
          </svg>
        </div>

        <AnimatePresence>
          {displayMessages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 15, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              style={{
                display: 'flex', gap: '16px', alignItems: 'flex-start',
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                position: 'relative', zIndex: 1
              }}
            >
              <div style={{
                width: '40px', height: '40px', borderRadius: '0px',
                background: msg.role === 'user' ? 'var(--user-msg-bg)' : 'var(--icon-bg)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                color: msg.role === 'user' ? 'var(--text-inverse)' : 'var(--text-primary)',
                boxShadow: msg.role === 'user' ? '0 4px 12px var(--accent-glow)' : 'none'
              }}>
                {msg.role === 'user' ? <User size={20} fill="currentColor" /> : <Bot size={20} />}
              </div>

              <div className="chat-message-content-wrapper" style={{
                maxWidth: 'min(75%, 680px)', display: 'flex', flexDirection: 'column',
                alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start'
              }}>
                <div className="chat-bubble" style={{
                  background: msg.role === 'user' ? 'var(--user-msg-bg)' : 'var(--ai-msg-bg)',
                  padding: '16px 20px', borderRadius: '0px', lineHeight: '1.6', fontSize: '1.05rem',
                  color: msg.role === 'user' ? 'var(--text-inverse)' : 'var(--text-primary)',
                  border: msg.role === 'assistant' ? '1px solid var(--panel-border)' : 'none',
                  whiteSpace: 'pre-wrap'
                }}>
                  {msg.content}
                </div>

                {msg.model !== undefined && msg.model !== 'system' && (
                  <motion.span
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
                    style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '8px', padding: '0 8px' }}
                  >
                    {t.routing} <strong style={{ color: 'var(--text-primary)' }}>{msg.model}</strong>
                    {msg.cost !== undefined && msg.cost > 0 && (
                      <> • {t.costLabel} <strong style={{ color: '#52c41a' }}>${formatUsd(msg.cost)}</strong></>
                    )}
                    {msg.routingReason && (
                      <><br /><span style={{ fontSize: '0.75rem', opacity: 0.8 }}>{msg.routingReason}</span></>
                    )}
                  </motion.span>
                )}
              </div>
            </motion.div>
          ))}

          {isTyping && (
            <motion.div
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }}
              style={{ display: 'flex', gap: '16px', alignItems: 'center', position: 'relative', zIndex: 1 }}
            >
              <div style={{ width: '40px', height: '40px', borderRadius: '0px', background: 'var(--icon-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Bot size={20} />
              </div>
              <div style={{ display: 'flex', gap: '6px', background: 'var(--ai-msg-bg)', padding: '20px', borderRadius: '0px' }}>
                <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0 }} style={{ width: '8px', height: '8px', background: 'var(--text-secondary)', borderRadius: '50%' }} />
                <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.2 }} style={{ width: '8px', height: '8px', background: 'var(--text-secondary)', borderRadius: '50%' }} />
                <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.4 }} style={{ width: '8px', height: '8px', background: 'var(--text-secondary)', borderRadius: '50%' }} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-area" style={{ padding: '24px 32px', borderTop: '1px solid var(--panel-border)' }}>
        <div className="chat-input-wrapper" style={{
          display: 'flex', background: 'var(--input-bg)', borderRadius: '0px',
          border: '1px solid var(--panel-border)', padding: '10px 10px 10px 20px',
          transition: 'all 0.3s ease', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={t.inputPlaceholder}
            style={{
              flex: 1, background: 'transparent', border: 'none',
              color: 'var(--text-primary)', fontSize: '1.05rem', outline: 'none', fontFamily: 'inherit'
            }}
          />
          <motion.button
            whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            onClick={handleSend}
            style={{
              background: 'var(--user-msg-bg)', border: 'none', width: '44px', height: '44px',
              borderRadius: '0px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-inverse)', cursor: 'pointer',
              opacity: input.trim() ? 1 : 0.5, transition: 'opacity 0.2s ease'
            }}
          >
            <Send size={20} style={{ marginLeft: '-2px' }} />
          </motion.button>
        </div>
      </div>
    </motion.div>
  )
}
