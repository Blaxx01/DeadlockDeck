import type { SoulsGain } from '../game/souls'

/** Meilensteine einer Session/Runde: „2× 🥈 Silber · ★ Haze · +150 ◆“ */
export function MilestoneSummary({ gains }: { gains: readonly SoulsGain[] }) {
  if (gains.length === 0) return null
  const counts = new Map<string, number>()
  for (const g of gains) if (g.label) counts.set(g.label, (counts.get(g.label) ?? 0) + 1)
  const parts = [...counts].map(([label, n]) => (n > 1 ? `${n}× ${label}` : label))
  const souls = gains.reduce((sum, g) => sum + g.amount, 0)
  return (
    <p className="milestone-summary center-text">
      <span className="muted small">Meilensteine</span>
      <span>{parts.join(' · ')}</span>
      <span className="souls-earned">+{souls.toLocaleString('de-DE')} ◆</span>
    </p>
  )
}
