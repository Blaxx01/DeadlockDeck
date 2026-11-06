import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { describeCards, getWeaknesses, LEECH_LAPSES, MISTAKE_SOURCE_LABEL, WEAK_DAYS, WEAK_MAX_CARDS } from '../game/weakness'
import type { View } from '../nav'
import { Learn } from './Learn'

interface Props {
  onExit: () => void
}

/** Verlaufseintrag der Item-Detailseite im Training: zurück in diese Ansicht */
const WEAK_VIEW: View = { name: 'weak' }

type Phase = { name: 'list' } | { name: 'train'; ids: string[]; no: number }

export function Weakness({ onExit }: Props) {
  const [phase, setPhase] = useState<Phase>({ name: 'list' })
  const list = useLiveQuery(async () => {
    const weaknesses = await getWeaknesses()
    const cards = await describeCards(weaknesses.map(w => w.cardId))
    return weaknesses.map(w => ({ ...w, card: cards.get(w.cardId) }))
  }, [])

  if (phase.name === 'train') {
    return (
      <Learn
        key={phase.no}
        deck="items"
        weakIds={phase.ids}
        navView={WEAK_VIEW}
        onExit={() => setPhase({ name: 'list' })}
      />
    )
  }

  if (!list) return <div className="center muted">Lade…</div>

  return (
    <div className="weak">
      <header className="home-head">
        <button className="icon-btn" onClick={onExit} aria-label="Zurück">←</button>
        <h1>Schwächen üben</h1>
        <span className="icon-btn" aria-hidden="true" />
      </header>
      <p className="muted small">
        Karten, bei denen du dich in den letzten {WEAK_DAYS} Tagen vertan hast – egal ob beim Lernen, im Quiz, beim
        Hero erraten, im Build-Quiz, im Sprint oder beim Überleben. „Gewusst“ im Training behebt die Schwäche.
        Hartnäckige Karten (mind. {LEECH_LAPSES}× vergessen) bleiben dabei, bis sie wieder sitzen (Silber).
      </p>

      {list.length === 0 ? (
        <div className="panel">
          <p>Keine Schwächen in den letzten {WEAK_DAYS} Tagen 💪</p>
          <button onClick={onExit}>Zurück</button>
        </div>
      ) : (
        <>
          <button
            className="primary"
            onClick={() => setPhase({ name: 'train', ids: list.map(w => w.cardId), no: Date.now() })}
          >
            Training starten ({list.length} {list.length === 1 ? 'Karte' : 'Karten'})
          </button>
          <div className="panel">
            <h2>Am häufigsten vertan</h2>
            <ul className="weak-list">
              {list.map(w => (
                <li key={w.cardId}>
                  <span className="weak-img">{w.card?.image && <img src={w.card.image} alt="" draggable={false} />}</span>
                  <span className="weak-text">
                    <span className="weak-name">{w.card?.label ?? w.cardId}</span>
                    <span className="muted small">
                      {[w.card?.kind, ...w.sources.map(src => MISTAKE_SOURCE_LABEL[src]), w.leech && `hartnäckig (${w.leech}× vergessen)`]
                        .filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className={`weak-count${w.count === 0 ? ' leech' : ''}`}>{w.count > 0 ? `${w.count}×` : '🔁'}</span>
                </li>
              ))}
            </ul>
            {list.filter(w => w.count > 0).length === WEAK_MAX_CARDS && (
              <p className="muted small">Die {WEAK_MAX_CARDS} häufigsten – behobene machen Platz für die nächsten.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
