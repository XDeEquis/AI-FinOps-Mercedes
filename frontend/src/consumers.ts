import type { Department } from './i18n'

// Debe coincidir EXACTAMENTE con DEFAULT_CONSUMERS en backend/db.js.
const DEPARTMENT_TO_CONSUMER: Record<Department, string> = {
  marketing: 'equipo-marketing',
  engineering: 'equipo-ingenieria',
  sales: 'equipo-ventas',
  support: 'equipo-soporte'
}

export function getConsumerId(department: Department): string {
  return DEPARTMENT_TO_CONSUMER[department]
}
