import { useMemo } from 'react'
import { SECTION_LABEL, SLOT_LABEL, type CardSection, type ItemCard, type Stat } from '../data/model'
import { sanitizeHtml } from '../data/sanitize'

function StatList({ stats }: { stats: Stat[] }) {
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

function Section({ section }: { section: CardSection }) {
  const html = useMemo(() => (section.html ? sanitizeHtml(section.html) : ''), [section.html])
  return (
    <section className={`sec sec-${section.type}`}>
      <h3>{SECTION_LABEL[section.type]}</h3>
      {html && <p className="desc" dangerouslySetInnerHTML={{ __html: html }} />}
      <StatList stats={section.stats} />
    </section>
  )
}

/** Namen als Text – oder als antippbare Links, wenn `onClick` gesetzt ist */
function NameList({ names, onClick }: { names: string[]; onClick?: (name: string) => void }) {
  if (!onClick) return <>{names.join(', ')}</>
  return (
    <>
      {names.map((name, i) => (
        <span key={name}>
          {i > 0 && ', '}
          <button className="link" onClick={() => onClick(name)}>{name}</button>
        </span>
      ))}
    </>
  )
}

interface Props {
  card: ItemCard
  /** Build-Pfad-Namen antippbar machen (Shop-Detailseite) */
  onItemClick?: (name: string) => void
}

export function ItemBack({ card, onItemClick }: Props) {
  return (
    <div className="back-content">
      <header className="back-head">
        <h2>{card.name}</h2>
        <div className="chips">
          <span className={`chip slot-${card.slot}`}>{SLOT_LABEL[card.slot]}</span>
          <span className="chip">Tier {card.tier}</span>
          {card.cost > 0 && <span className="chip souls">{card.cost.toLocaleString('de-DE')} Souls</span>}
          {card.isActive && <span className="chip active">Aktiv</span>}
        </div>
      </header>

      {card.timings.length > 0 && (
        <div className="timings">
          {card.timings.map((t, i) => (
            <div key={i} className="timing">
              <span className="stat-value">{t.value}</span>
              <span className="stat-label">{t.label}</span>
            </div>
          ))}
        </div>
      )}

      {card.sections.map((s, i) => <Section key={i} section={s} />)}

      {(card.buildsFrom.length > 0 || card.upgradesTo.length > 0) && (
        <section className="sec build">
          <h3>Build-Pfad</h3>
          {card.buildsFrom.length > 0 && <p><span className="muted">Baut auf:</span> <NameList names={card.buildsFrom} onClick={onItemClick} /></p>}
          {card.upgradesTo.length > 0 && <p><span className="muted">Upgradet zu:</span> <NameList names={card.upgradesTo} onClick={onItemClick} /></p>}
        </section>
      )}
    </div>
  )
}
