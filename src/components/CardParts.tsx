import { useMemo } from 'react'
import type { Stat } from '../data/model'
import { sanitizeHtml } from '../data/sanitize'

/** Werte-Liste: Wert links, Bezeichnung rechts */
export function StatList({ stats }: { stats: Stat[] }) {
  if (!stats.length) return null
  return (
    <ul className="stats">
      {stats.map((s, i) => (
        <li key={i} className={s.negative ? 'neg' : undefined}>
          <span className="stat-value">{s.value}</span>
          <span className="stat-label">
            {s.label}
            {s.conditional && <em className="cond"> (bedingt)</em>}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Kacheln für Cooldown, Dauer, Reichweite, Aufladungen */
export function TimingTiles({ timings }: { timings: Stat[] }) {
  if (!timings.length) return null
  return (
    <div className="timings">
      {timings.map((t, i) => (
        <div key={i} className="timing">
          <span className="stat-value">{t.value}</span>
          <span className="stat-label">{t.label}</span>
        </div>
      ))}
    </div>
  )
}

/** Text aus der API – vor der Anzeige auf harmlose Formatierung reduziert */
export function SafeHtml({ html, className = 'desc', as = 'p' }: { html?: string; className?: string; as?: 'p' | 'div' | 'span' }) {
  const clean = useMemo(() => (html ? sanitizeHtml(html) : ''), [html])
  if (!clean) return null
  const Tag = as
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: clean }} />
}

/** Bild mit Platzhalter, falls es (offline) nicht geladen werden kann */
export function CardImage({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  if (!src) return <div className="img-missing">Bild nicht verfügbar</div>
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      draggable={false}
      onError={e => {
        const el = e.currentTarget
        el.style.visibility = 'hidden'
      }}
    />
  )
}
