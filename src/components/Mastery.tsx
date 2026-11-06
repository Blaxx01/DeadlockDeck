import { MASTERY_LABEL, MASTERY_MEDAL, type Mastery, type MasteryCounts } from '../game/mastery'

const LEVELS = ['gold', 'silver', 'bronze'] as const

/** Anteile ohne Überschneidung: Gold, nur Silber, nur Bronze, noch neu */
function segments(c: MasteryCounts): Record<(typeof LEVELS)[number] | 'none', number> {
  return { gold: c.gold, silver: c.silver - c.gold, bronze: c.learned - c.silver, none: c.total - c.learned }
}

/** Dünner Balken ohne Text: Gold | Silber | Bronze | noch neu (Fläche) */
export function MasteryBar({ counts }: { counts: MasteryCounts }) {
  const seg = segments(counts)
  return (
    <span className="mastery-bar" aria-hidden="true">
      {LEVELS.map(level => seg[level] > 0 && <span key={level} className={`seg seg-${level}`} style={{ flexGrow: seg[level] }} />)}
      {seg.none > 0 && <span className="seg seg-none" style={{ flexGrow: seg.none }} />}
    </span>
  )
}

/** Legende zu den Balken – mit Zahlen, wenn `counts` gegeben ist */
export function MasteryLegend({ counts }: { counts?: MasteryCounts }) {
  const seg = counts && segments(counts)
  return (
    <span className="mastery-legend small">
      {LEVELS.map(level => (
        <span key={level} className="legend-item">
          <span className={`swatch seg-${level}`} aria-hidden="true" />
          {MASTERY_MEDAL[level]} {MASTERY_LABEL[level]}{seg ? ` ${seg[level]}` : ''}
        </span>
      ))}
      <span className="legend-item">
        <span className="swatch seg-none" aria-hidden="true" />
        Neu{seg ? ` ${seg.none}` : ''}
      </span>
    </span>
  )
}

/** Medaille an einer Kachel (zweites Merkmal neben dem Rahmen) */
export function Medal({ level }: { level: Mastery }) {
  if (level === 'none') return null
  return <span className={`medal medal-${level}`} role="img" aria-label={MASTERY_LABEL[level]}>{MASTERY_MEDAL[level]}</span>
}

/** ★★★☆☆ */
export function Stars({ count, max }: { count: number; max: number }) {
  return (
    <span className="stars" role="img" aria-label={`${count} von ${max} Sternen`}>
      {Array.from({ length: max }, (_, i) => <span key={i} className={i < count ? 'on' : 'off'}>★</span>)}
    </span>
  )
}
