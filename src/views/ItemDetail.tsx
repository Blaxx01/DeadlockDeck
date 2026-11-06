import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ItemBack } from '../components/ItemBack'
import { PatchNote } from '../components/PatchNote'
import { showPatchNote } from '../data/patches'
import { db } from '../data/db'
import { CORRUPTED_VARIANCE_PERCENT, type CorruptedInfo, type ItemCard } from '../data/model'
import { describeLearnState, requestLearn } from '../srs/srs'
import { MASTERY_LABEL, MASTERY_MEDAL, MASTERY_NEXT, masteryOf } from '../game/mastery'
import { isLeech } from '../game/weakness'
import { InlineNote } from '../components/Notes'

interface Props {
  card: ItemCard
  cards: readonly ItemCard[]
  onBack: () => void
  onOpen: (id: string) => void
  /** Wohin „Zurück“ führt – Anzeige im Kopf (Standard: Shop) */
  backLabel?: string
}

function BrokerSection({ info }: { info: CorruptedInfo }) {
  return (
    <section className="sec broker">
      <h3>Broker (Corrupted)</h3>
      {info.price && <p>Preis: <b className="souls">{info.price.toLocaleString('de-DE')} Souls</b></p>}
      {info.bonuses.length > 0 && (
        <ul className="stats">
          {info.bonuses.map((b, i) => (
            <li key={i}>
              <span className="stat-value">{b.value}</span>
              <span className="stat-label">
                {b.label} <span className="small">(statt {b.base}{b.varies ? '' : ', fest'})</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {info.penalties.length > 0 && (
        <>
          <p className="muted small">Dazu kommt <b>einer</b> dieser Nachteile, zufällig gewürfelt:</p>
          <ul className="stats">
            {info.penalties.map((p, i) => (
              <li key={i} className="neg">
                <span className="stat-value">{p.value}</span>
                <span className="stat-label">{p.label}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted small">Die Werte schwanken je Match um ±{CORRUPTED_VARIANCE_PERCENT} %.</p>
    </section>
  )
}

export function ItemDetail({ card, cards, onBack, onOpen, backLabel = 'Shop' }: Props) {
  // { review } statt review, damit „lädt noch“ (undefined) von „keine Karte“ unterscheidbar ist
  const loaded = useLiveQuery(async () => ({ review: await db.reviews.get(card.id) }), [card.id])
  // Patch-Hinweis: Geändert 30 Tage, Neu 7 Tage (Zeitpunkt in der Abfrage prüfen, nicht beim Rendern)
  const patch = useLiveQuery(async () => {
    const p = await db.patches.get(card.id)
    return showPatchNote(p, Date.now()) ? p : undefined
  }, [card.id])
  const [justRequested, setJustRequested] = useState(false)
  // Fokus in die Detailseite: Tasten (z. B. Leertaste = scrollen) wirken hier und nicht auf dem
  // Link/der Kachel darunter, die sie geöffnet hat (sonst öffnet Enter/Leertaste sie erneut)
  const pageRef = useRef<HTMLDivElement>(null)
  useEffect(() => { pageRef.current?.focus({ preventScroll: true }) }, [card.id])
  const byName = useMemo(() => new Map(cards.map(c => [c.name, c])), [cards])
  const state = loaded ? describeLearnState(loaded.review) : undefined
  const level = loaded ? masteryOf(loaded.review) : undefined

  function openByName(name: string) {
    const target = byName.get(name)
    if (target) onOpen(target.id)
  }

  async function learnNow() {
    await requestLearn(card.id)
    setJustRequested(true)
  }

  return (
    <div className="detail-page" role="dialog" aria-label={card.name} tabIndex={-1} ref={pageRef}>
      <div className="detail-inner">
        <header className="home-head">
          <button className="icon-btn" onClick={onBack} aria-label="Zurück">←</button>
          <span className="muted small">{backLabel}</span>
          <span className="icon-btn" aria-hidden="true" />
        </header>

        <div className={`detail-hero slot-bg-${card.slot}`}>
          {card.image && <img src={card.image} alt="" draggable={false} />}
        </div>

        {patch && <PatchNote patch={patch} />}

        <ItemBack card={card} onItemClick={openByName} />

        <section className="sec learn-state">
          <h3>Lernstand</h3>
          {state && (
            <p>
              <b>{state.label}</b>
              {state.detail && <span className="muted"> – {state.detail}</span>}
            </p>
          )}
          {level && (
            <p className="small album-line">
              Sammelalbum: <b>{MASTERY_MEDAL[level]} {MASTERY_LABEL[level]}</b>
              <span className="muted"> – {level === 'gold' ? 'höchste Stufe' : `nächste Stufe: ${MASTERY_NEXT[level]}`}</span>
            </p>
          )}
          {loaded?.review && isLeech(loaded.review) && (
            <p className="small leech-hint">
              Hartnäckig: schon {loaded.review.lapses}× vergessen – steht in „Schwächen üben“, bis die Karte wieder sitzt (Silber).
            </p>
          )}
          {loaded && !loaded.review?.requested && (
            <button onClick={learnNow}>Jetzt lernen</button>
          )}
          {justRequested && <p className="good small">Kommt in deiner nächsten Lern-Session dran.</p>}
        </section>

        <section className="sec">
          <h3>Merkhilfe</h3>
          <InlineNote cardId={card.id} />
        </section>

        {card.corrupted && <BrokerSection info={card.corrupted} />}
      </div>
    </div>
  )
}
