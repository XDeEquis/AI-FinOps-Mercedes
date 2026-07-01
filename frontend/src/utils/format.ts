// Formato monetario consistente en toda la app. Los precios del hackathon
// son tan bajos ($0.05-$0.24 por millón de tokens) que un simple toFixed(2)
// o toFixed(4) puede redondear a "$0.00" y dar la falsa impresión de que el
// gasto no avanza. Usamos más decimales cuando el importe es pequeño.
export function formatUsd(value: number | undefined | null): string {
  const v = Number(value || 0)
  if (v === 0) return '0.00'
  return v.toFixed(6)
}

export function formatPct(ratio: number | undefined | null): string {
  const v = Number(ratio || 0) * 100
  if (v === 0) return '0%'
  if (v >= 0.1) return `${v.toFixed(1)}%`
  return `${v.toFixed(4)}%`
}
