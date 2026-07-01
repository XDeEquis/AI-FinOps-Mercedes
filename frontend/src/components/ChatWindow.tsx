import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Bot, User } from 'lucide-react'
import { translations } from '../i18n'
import type { Language } from '../i18n'
import type { UserSession } from '../App'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  model?: string
  cost?: number
}

export function ChatWindow({ onMessageSent, lang, user }: { onMessageSent: (cost: number) => void, lang: Language, user: UserSession }) {
  const t = translations[lang]
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'assistant', content: '', model: 'system', cost: 0 } // Se traduce dinámicamente en el render
  ])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  const handleSend = () => {
    if (!input.trim()) return

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsTyping(true)

    // Simulador de respuesta del Proxy personalizado según departamento
    setTimeout(() => {
      const isComplex = input.length > 50
      let modelUsed = ''
      let estimatedCost = 0
      let responseTemplate = ''

      switch (user.department) {
        case 'engineering':
          modelUsed = isComplex ? 'mistral:7b (Ollama)' : 'llama-3.1-8b (Groq)'
          estimatedCost = isComplex ? 0.00015 : 0.00005
          responseTemplate = t.deptMockResponse.engineering
          break
        case 'marketing':
          modelUsed = isComplex ? 'mistral:7b (Ollama)' : 'llama3.2:3b (Ollama)'
          estimatedCost = isComplex ? 0.00015 : 0.00006
          responseTemplate = t.deptMockResponse.marketing
          break
        case 'sales':
          modelUsed = isComplex ? 'llama-3.1-8b (Groq)' : 'llama3.2:3b (Ollama)'
          estimatedCost = isComplex ? 0.00005 : 0.00006
          responseTemplate = t.deptMockResponse.sales
          break
        case 'support':
        default:
          modelUsed = isComplex ? 'llama-3.1-8b (Groq)' : 'llama3.2:3b (Ollama)'
          estimatedCost = isComplex ? 0.00005 : 0.00006
          responseTemplate = t.deptMockResponse.support
          break
      }
      
      onMessageSent(estimatedCost)
      
      const aiMsg: Message = { 
        id: (Date.now() + 1).toString(), 
        role: 'assistant', 
        content: responseTemplate.replace('{model}', modelUsed),
        model: modelUsed,
        cost: estimatedCost
      }
      setMessages(prev => [...prev, aiMsg])
      setIsTyping(false)
    }, 1800)
  }

  // Traducción en tiempo real para el primer mensaje (bienvenida)
  const displayMessages = messages.map(msg => 
    msg.id === '1' ? { ...msg, content: t.deptWelcome[user.department] } : msg
  )

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="glass-panel"
      style={{ 
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      <div style={{ 
        flex: 1, 
        overflowY: 'auto', 
        padding: '32px',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px'
      }}>
        <AnimatePresence>
          {displayMessages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 15, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              style={{
                display: 'flex',
                gap: '16px',
                alignItems: 'flex-start',
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row'
              }}
            >
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                background: msg.role === 'user' ? 'var(--user-msg-bg)' : 'var(--icon-bg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                color: msg.role === 'user' ? 'var(--text-inverse)' : 'var(--text-primary)',
                boxShadow: msg.role === 'user' ? '0 4px 12px var(--accent-glow)' : 'none'
              }}>
                {msg.role === 'user' ? <User size={20} /> : <Bot size={20} />}
              </div>
              
              <div style={{
                maxWidth: '75%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start'
              }}>
                <div style={{
                  background: msg.role === 'user' ? 'var(--user-msg-bg)' : 'var(--ai-msg-bg)',
                  padding: '16px 20px',
                  borderRadius: '20px',
                  borderTopRightRadius: msg.role === 'user' ? '4px' : '20px',
                  borderTopLeftRadius: msg.role === 'assistant' ? '4px' : '20px',
                  lineHeight: '1.6',
                  fontSize: '1.05rem',
                  color: msg.role === 'user' ? 'var(--text-inverse)' : 'var(--text-primary)',
                  border: msg.role === 'assistant' ? '1px solid var(--panel-border)' : 'none',
                  whiteSpace: 'pre-wrap'
                }}>
                  {msg.content}
                </div>
                
                {msg.cost !== undefined && msg.cost > 0 && (
                  <motion.span 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 }}
                    style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '8px', padding: '0 8px' }}
                  >
                    {t.routing} <strong style={{color: 'var(--text-primary)'}}>{msg.model}</strong> • {t.costLabel} <strong style={{color: '#52c41a'}}>${msg.cost.toFixed(5)}</strong>
                  </motion.span>
                )}
              </div>
            </motion.div>
          ))}
          
          {isTyping && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              style={{ display: 'flex', gap: '16px', alignItems: 'center' }}
            >
              <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--icon-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Bot size={20} />
              </div>
              <div style={{ display: 'flex', gap: '6px', background: 'var(--ai-msg-bg)', padding: '20px', borderRadius: '20px', borderTopLeftRadius: '4px' }}>
                <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0 }} style={{ width: '8px', height: '8px', background: 'var(--text-secondary)', borderRadius: '50%' }} />
                <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.2 }} style={{ width: '8px', height: '8px', background: 'var(--text-secondary)', borderRadius: '50%' }} />
                <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.4 }} style={{ width: '8px', height: '8px', background: 'var(--text-secondary)', borderRadius: '50%' }} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      <div style={{ padding: '24px 32px', borderTop: '1px solid var(--panel-border)' }}>
        <div style={{ 
          display: 'flex', 
          background: 'var(--input-bg)', 
          borderRadius: '16px',
          border: '1px solid var(--panel-border)',
          padding: '10px 10px 10px 20px',
          transition: 'all 0.3s ease',
          boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <input 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={t.inputPlaceholder}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: 'var(--text-primary)',
              fontSize: '1.05rem',
              outline: 'none',
              fontFamily: 'inherit'
            }}
          />
          <motion.button 
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleSend}
            style={{
              background: 'var(--user-msg-bg)',
              border: 'none',
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-inverse)',
              cursor: 'pointer',
              opacity: input.trim() ? 1 : 0.5,
              transition: 'opacity 0.2s ease'
            }}
          >
            <Send size={20} style={{ marginLeft: '-2px' }} />
          </motion.button>
        </div>
      </div>
    </motion.div>
  )
}
