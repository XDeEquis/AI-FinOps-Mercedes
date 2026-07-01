import { useState, useEffect, useRef } from 'react'
import { Sun, Moon, Globe, ChevronDown, LogOut, Type } from 'lucide-react'
import { motion } from 'framer-motion'
import { ChatWindow } from './components/ChatWindow'
import { FinOpsSidebar } from './components/FinOpsSidebar'
import { translations } from './i18n'
import type { Language, Department } from './i18n'
import { getConsumerId } from './consumers'
import './index.css'

export interface UserSession {
  name: string
  department: Department
}

type FontSize = 'small' | 'medium' | 'large'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'
const DASHBOARD_URL = import.meta.env.VITE_DASHBOARD_URL || 'http://localhost:8501'

export default function App() {
  const [budget, setBudget] = useState(5.00)
  const [spent, setSpent] = useState(0)
  const [isDarkMode, setIsDarkMode] = useState(true)
  const [lang, setLang] = useState<Language>('es')
  const [fontSize, setFontSize] = useState<FontSize>('medium')
  
  const [isLangOpen, setIsLangOpen] = useState(false)
  const [isFontOpen, setIsFontOpen] = useState(false)
  
  const dropdownRef = useRef<HTMLDivElement>(null)
  const fontDropdownRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    // Aplicar tamaño de fuente a la raíz (html). rem escalará basado en esto.
    if (fontSize === 'small') document.documentElement.style.fontSize = '14px'
    else if (fontSize === 'medium') document.documentElement.style.fontSize = '16px'
    else if (fontSize === 'large') document.documentElement.style.fontSize = '18px'
  }, [fontSize])

  useEffect(() => {
    document.documentElement.classList.remove('dept-marketing', 'dept-engineering', 'dept-sales', 'dept-support')
    if (user) {
      document.documentElement.classList.add(`dept-${user.department}`)
    }
  }, [user])

  // Carga presupuesto/gasto real del consumidor al iniciar sesión
  useEffect(() => {
    if (!user) return
    const consumerId = getConsumerId(user.department)
    let cancelled = false
    fetch(`${API_BASE_URL}/v1/consumers/${consumerId}/summary`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        if (typeof data?.monthly_budget_usd === 'number') setBudget(data.monthly_budget_usd)
        if (typeof data?.current_spend_usd === 'number') setSpent(data.current_spend_usd)
      })
      .catch(() => { /* backend no disponible, valores por defecto */ })
    return () => { cancelled = true }
  }, [user])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsLangOpen(false)
      }
      if (fontDropdownRef.current && !fontDropdownRef.current.contains(event.target as Node)) {
        setIsFontOpen(false)
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

  const fontOptions: { code: FontSize, label: string }[] = [
    { code: 'small', label: translations[lang].fontSmall },
    { code: 'medium', label: translations[lang].fontMedium },
    { code: 'large', label: translations[lang].fontLarge }
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

  const renderControls = (inSidebar: boolean) => {
    return (
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '12px',
        width: inSidebar ? '100%' : 'auto',
        alignItems: inSidebar ? 'stretch' : 'flex-end'
      }}>
        {user && inSidebar && (
          <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
            <button 
              onClick={handleLogout}
              className="header-btn"
              style={{ flex: 1, justifyContent: 'center', padding: '0 8px' }}
            >
              <LogOut size={16} />
              {translations[lang].logoutLabel}
            </button>
            <a 
              href={DASHBOARD_URL}
              target="_blank" 
              rel="noopener noreferrer"
              className="header-btn"
              style={{
                flex: 1,
                justifyContent: 'center',
                padding: '0 8px',
                textDecoration: 'none'
              }}
            >
              Dashboard
            </a>
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', width: '100%', justifyContent: inSidebar ? 'space-between' : 'flex-end' }}>
          
          {/* Menu Idioma */}
          <div ref={dropdownRef} style={{ position: 'relative', flex: inSidebar ? 1 : 'none' }}>
            <button 
              onClick={() => setIsLangOpen(!isLangOpen)}
              className="header-btn"
              style={{ width: '100%', justifyContent: 'center' }}
            >
              <Globe size={18} />
              {lang.toUpperCase()}
              <ChevronDown size={16} style={{ transition: 'transform 0.2s', transform: isLangOpen ? 'rotate(180deg)' : 'rotate(0)' }} />
            </button>

            {isLangOpen && (
              <div style={{
                position: 'absolute',
                bottom: inSidebar ? 'calc(100% + 8px)' : 'auto',
                top: inSidebar ? 'auto' : 'calc(100% + 8px)',
                right: inSidebar ? 'auto' : 0,
                left: inSidebar ? 0 : 'auto',
                background: 'var(--bg-color)',
                border: '1px solid var(--panel-border)',
                borderRadius: '8px',
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                minWidth: '160px',
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
                      padding: '8px 12px',
                      borderRadius: '8px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontSize: '0.9rem',
                      fontWeight: lang === l.code ? 600 : 400,
                      border: 'none',
                      color: 'var(--text-primary)',
                      transition: 'background 0.2s'
                    }}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Menu Tamaño Fuente */}
          <div ref={fontDropdownRef} style={{ position: 'relative' }}>
            <button 
              onClick={() => setIsFontOpen(!isFontOpen)}
              className="header-btn"
              style={{ width: '48px', padding: 0, justifyContent: 'center', flexShrink: 0 }}
              title={translations[lang].fontMedium}
            >
              <Type size={18} />
            </button>

            {isFontOpen && (
              <div style={{
                position: 'absolute',
                bottom: inSidebar ? 'calc(100% + 8px)' : 'auto',
                top: inSidebar ? 'auto' : 'calc(100% + 8px)',
                right: 0, // Alineado a la derecha siempre para el icono
                background: 'var(--bg-color)',
                border: '1px solid var(--panel-border)',
                borderRadius: '8px',
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                minWidth: '160px',
                boxShadow: 'var(--glass-shadow)',
                zIndex: 100
              }}>
                {fontOptions.map((f) => (
                  <button
                    key={f.code}
                    onClick={() => {
                      setFontSize(f.code)
                      setIsFontOpen(false)
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--icon-bg)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = fontSize === f.code ? 'var(--icon-bg)' : 'transparent'}
                    style={{
                      background: fontSize === f.code ? 'var(--icon-bg)' : 'transparent',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontSize: '0.9rem',
                      fontWeight: fontSize === f.code ? 600 : 400,
                      border: 'none',
                      color: 'var(--text-primary)',
                      transition: 'background 0.2s'
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Boton Tema */}
          <button 
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="header-btn"
            style={{ width: '48px', padding: 0, justifyContent: 'center', flexShrink: 0 }}
          >
            {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`app-shell ${user ? 'app-shell-auth' : 'app-shell-login'}`}>
      
      {!user && (
        <div className="floating-controls">
          {renderControls(false)}
        </div>
      )}

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
          <FinOpsSidebar budget={budget} spent={spent} lang={lang} user={user}>
            {renderControls(true)}
          </FinOpsSidebar>
          
          <ChatWindow
            onMessageSent={({ currentSpend, monthlyBudget }) => {
              setSpent(currentSpend)
              if (monthlyBudget > 0) setBudget(monthlyBudget)
            }}
            lang={lang}
            user={user}
          />
        </>
      )}
    </div>
  )
}
