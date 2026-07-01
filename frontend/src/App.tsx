import { useState, useEffect, useRef } from 'react'
import { Sun, Moon, Globe, ChevronDown, LogOut } from 'lucide-react'
import { motion } from 'framer-motion'
import { ChatWindow } from './components/ChatWindow'
import { FinOpsSidebar } from './components/FinOpsSidebar'
import { translations } from './i18n'
import type { Language, Department } from './i18n'
import './index.css'

export interface UserSession {
  name: string
  department: Department
}

export default function App() {
  const [budget] = useState(5.00)
  const [spent, setSpent] = useState(1.24)
  const [isDarkMode, setIsDarkMode] = useState(true)
  const [lang, setLang] = useState<Language>('es')
  const [isLangOpen, setIsLangOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Registration/login states
  const [user, setUser] = useState<UserSession | null>(null)
  const [tempName, setTempName] = useState('')
  const [tempDept, setTempDept] = useState<Department>('marketing')

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.remove('light')
    } else {
      document.documentElement.classList.add('light')
    }
  }, [isDarkMode])

  // Inyectar clase de departamento en el html para que cambien las variables de color en index.css
  useEffect(() => {
    document.documentElement.classList.remove('dept-marketing', 'dept-engineering', 'dept-sales', 'dept-support')
    if (user) {
      document.documentElement.classList.add(`dept-${user.department}`)
    }
  }, [user])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsLangOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])
  
  const languages: { code: Language, label: string }[] = [
    { code: 'es', label: 'ES - Español' },
    { code: 'en', label: 'EN - English' },
    { code: 'de', label: 'DE - Deutsch' },
    { code: 'fr', label: 'FR - Français' },
    { code: 'it', label: 'IT - Italiano' },
    { code: 'ja', label: 'JA - 日本語' },
    { code: 'ko', label: 'KO - 한국어' }
  ]

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!tempName.trim()) return
    setUser({ name: tempName, department: tempDept })
  }

  const handleLogout = () => {
    setUser(null)
    setTempName('')
  }

  return (
    <div style={{ 
      display: 'flex', 
      height: '100%', 
      padding: '32px', 
      gap: '32px', 
      maxWidth: '1400px', 
      margin: '0 auto', 
      position: 'relative',
      alignItems: user ? 'stretch' : 'center',
      justifyContent: user ? 'stretch' : 'center'
    }}>
      
      {/* Top right control panel */}
      <div style={{ position: 'absolute', top: '32px', right: '32px', display: 'flex', gap: '12px', zIndex: 50 }}>
        
        {/* Logout / Change Department Button */}
        {user && (
          <button 
            onClick={handleLogout}
            style={{
              background: 'var(--panel-bg)',
              border: '1px solid var(--panel-border)',
              color: 'var(--text-primary)',
              borderRadius: '24px',
              padding: '0 16px',
              height: '48px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              backdropFilter: 'blur(10px)',
              fontWeight: 500,
              fontSize: '0.95rem',
              transition: 'all 0.2s'
            }}
          >
            <LogOut size={16} />
            {translations[lang].logoutLabel}
          </button>
        )}

        {/* Language Dropdown */}
        <div ref={dropdownRef} style={{ position: 'relative' }}>
          <button 
            onClick={() => setIsLangOpen(!isLangOpen)}
            style={{
              background: 'var(--panel-bg)',
              border: '1px solid var(--panel-border)',
              color: 'var(--text-primary)',
              borderRadius: '24px',
              padding: '0 16px',
              height: '48px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              backdropFilter: 'blur(10px)',
              fontWeight: 500,
              fontSize: '0.95rem',
              transition: 'all 0.2s'
            }}
          >
            <Globe size={18} />
            {lang.toUpperCase()}
            <ChevronDown size={16} style={{ transition: 'transform 0.2s', transform: isLangOpen ? 'rotate(180deg)' : 'rotate(0)' }} />
          </button>

          {isLangOpen && (
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              right: 0,
              background: 'var(--panel-bg)',
              border: '1px solid var(--panel-border)',
              borderRadius: '12px',
              padding: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              minWidth: '160px',
              backdropFilter: 'blur(24px)',
              boxShadow: 'var(--glass-shadow)',
              zIndex: 100
            }}>
              {languages.map((l) => (
                <button
                  key={l.code}
                  onClick={() => {
                    setLang(l.code)
                    setIsLangOpen(false)
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--icon-bg)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = lang === l.code ? 'var(--icon-bg)' : 'transparent'}
                  style={{
                    background: lang === l.code ? 'var(--icon-bg)' : 'transparent',
                    border: 'none',
                    color: 'var(--text-primary)',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    fontWeight: lang === l.code ? 600 : 400,
                    transition: 'background 0.2s'
                  }}
                >
                  {l.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Theme Toggle */}
        <button 
          onClick={() => setIsDarkMode(!isDarkMode)}
          style={{
            background: 'var(--panel-bg)',
            border: '1px solid var(--panel-border)',
            color: 'var(--text-primary)',
            borderRadius: '50%',
            width: '48px',
            height: '48px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            backdropFilter: 'blur(10px)',
            transition: 'all 0.2s'
          }}
        >
          {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
        </button>
      </div>

      {!user ? (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="glass-panel register-card"
        >
          <form onSubmit={handleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h1 className="register-title">{translations[lang].registerTitle}</h1>
              <p className="register-subtitle" style={{ margin: '8px 0 0 0' }}>{translations[lang].registerSubtitle}</p>
            </div>

            <div className="form-group">
              <label className="form-label">{translations[lang].nameLabel}</label>
              <input 
                type="text" 
                className="register-input" 
                value={tempName} 
                onChange={(e) => setTempName(e.target.value)} 
                placeholder={translations[lang].namePlaceholder}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">{translations[lang].deptLabel}</label>
              <select 
                className="register-select" 
                value={tempDept} 
                onChange={(e) => setTempDept(e.target.value as Department)}
              >
                <option value="marketing">{translations[lang].deptMarketing}</option>
                <option value="engineering">{translations[lang].deptEngineering}</option>
                <option value="sales">{translations[lang].deptSales}</option>
                <option value="support">{translations[lang].deptSupport}</option>
              </select>
            </div>

            <button type="submit" className="register-btn">
              {translations[lang].enterBtn}
            </button>
          </form>
        </motion.div>
      ) : (
        <>
          <FinOpsSidebar budget={budget} spent={spent} lang={lang} user={user} />
          <ChatWindow onMessageSent={(cost) => setSpent(s => s + cost)} lang={lang} user={user} />
        </>
      )}
    </div>
  )
}
