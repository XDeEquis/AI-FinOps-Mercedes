import { useState, useEffect, useRef } from 'react'
import { Sun, Moon, Globe, ChevronDown } from 'lucide-react'
import { ChatWindow } from './components/ChatWindow'
import { FinOpsSidebar } from './components/FinOpsSidebar'
import type { Language } from './i18n'
import './index.css'

export default function App() {
  const [budget, setBudget] = useState(5.00)
  const [spent, setSpent] = useState(1.24)
  const [isDarkMode, setIsDarkMode] = useState(true)
  const [lang, setLang] = useState<Language>('es')
  const [isLangOpen, setIsLangOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.remove('light')
    } else {
      document.documentElement.classList.add('light')
    }
  }, [isDarkMode])

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

  return (
    <div style={{ display: 'flex', height: '100%', padding: '32px', gap: '32px', maxWidth: '1400px', margin: '0 auto', position: 'relative' }}>
      
      <div style={{ position: 'absolute', top: '32px', right: '32px', display: 'flex', gap: '12px', zIndex: 50 }}>
        
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

      <FinOpsSidebar budget={budget} spent={spent} lang={lang} />
      <ChatWindow onMessageSent={(cost) => setSpent(s => s + cost)} lang={lang} />
    </div>
  )
}
