import type { ReactNode } from 'react'
import { COUNTER_MIN_RANK, effectSummary, formatFactor } from '../data/counters'
import type { CounterCard, ItemCard } from '../data/model'
import { CardImage } from './CardParts'

/** `answer`: Eingabefeld (Antwort eintippen) statt „Tippen zum Umdrehen“ */
export function CounterFront({ card, answer }: { card: CounterCard; answer?: ReactNode }) {
  return (
    <div className="front-content">
      <CardImage src={card.image} alt={card.heroName} className="hero-portrait" />
      <p className="counter-question">Was kaufst du gegen <b>{card.heroName}</b>?</p>
      {answer ?? <p className="hint">Tippen zum Umdrehen</p>}
    </div>
  )
}

interface BackProps {
  card: CounterCard
  /** Alle Items (Karten-ID → Karte) */
  items: ReadonlyMap<string, ItemCard>
  /** Item-Namen antippbar → Detailseite */
  onItemClick?: (name: string) => void
  /** Eingetipptes Item (Antwort eintippen) – wird markiert */
  highlight?: string
}

export function CounterBack({ card, items, onItemClick, highlight }: BackProps) {
  const top = card.top
    .map(c => ({ ...c, item: items.get(c.itemId) }))
    .filter((c): c is typeof c & { item: ItemCard } => !!c.item)
  const first = top[0]
  const date = new Date(card.updatedAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
  return (
    <div className="back-content">
      <header className="back-head">
        <h2 style={card.color ? { color: `color-mix(in srgb, ${card.color} 55%, var(--text))` } : undefined}>
          Counter gegen {card.heroName}
        </h2>
      </header>

      <ol className="counter-list">
        {top.map(({ item, factor }) => {
          const summary = effectSummary(item)
          return (
            <li key={item.id} className={item.id === highlight ? 'typed' : undefined}>
              <span className={`counter-icon slot-bg-${item.slot}`}>
                {item.image && <img src={item.image} alt="" draggable={false} />}
              </span>
              <div className="counter-text">
                <div className="counter-name">
                  {onItemClick
                    ? <button className="link" onClick={() => onItemClick(item.name)}>{item.name}</button>
                    : <b>{item.name}</b>}
                  <span className="counter-factor">{formatFactor(factor)}</span>
                </div>
                {summary && <p className="counter-effect">{summary}</p>}
              </div>
            </li>
          )
        })}
      </ol>

      {first && (
        <p className="muted small counter-foot">
          {formatFactor(first.factor)} = wird gegen {card.heroName} {formatFactor(first.factor).replace('×', '-mal')} so oft gekauft
          wie sonst · Ränge ab {COUNTER_MIN_RANK} · letzte 30 Tage · Stand {date}
        </p>
      )}
    </div>
  )
}
