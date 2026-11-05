import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { FlashCard, type FlashCardHandle } from '../components/FlashCard'
import { AbilityBack, AbilityFront, HeroBack, HeroFront } from '../components/HeroCards'
import { heroGlow } from '../components/heroStyle'
import { ItemBack } from '../components/ItemBack'
import { db, getSettings, type ReviewRecord, type Settings } from '../data/db'
import type { AbilityCard, HeroCard, ItemCard } from '../data/model'
import { newIntroducedToday, type DeckId } from '../decks'
import { buildQueue, isInLearnScope, localDate, rateCard, requeue } from '../srs/srs'

interface Props {
  deck: DeckId
  onExit: () => void
  /** Zusätzliche neue Karten über das Tageslimit hinaus */
  extraNew?: number
}

/** Eine Karte aus einem der drei Decks, mit allem, was die Lern-Ansicht braucht */
interface LearnEntry {
  id: string
  /** Reihenfolge neuer Karten */
  order: number
  image?: string
  front: ReactNode
  back: ReactNode
  frontClass?: string
  frontStyle?: CSSProperties
}

function itemEntry(card: ItemCard): LearnEntry {
  return { id: card.id, order: card.tier, image: card.image, front: <ItemFront card={card} />, back: <ItemBack card={card} />, frontClass: `slot-bg-${card.slot}` }
}

function abilityEntry(card: AbilityCard): LearnEntry {
  return { id: card.id, order: card.order, image: card.image, front: <AbilityFront card={card} />, back: <AbilityBack card={card} />, frontStyle: heroGlow(card.heroColor) }
}

function heroEntry(card: HeroCard): LearnEntry {
  return { id: card.id, order: card.order, image: card.image, front: <HeroFront card={card} />, back: <HeroBack card={card} />, frontStyle: heroGlow(card.color) }
}

async function loadEntries(deck: DeckId, settings: Settings, reviews: Map<string, ReviewRecord>): Promise<LearnEntry[]> {
  if (deck === 'abilities') return (await db.abilities.toArray()).map(abilityEntry)
  if (deck === 'heroes') return (await db.heroes.toArray()).map(heroEntry)
  const items = await db.items.toArray()
  return items.filter(i => isInLearnScope(settings.slots.includes(i.slot), reviews.get(i.id))).map(itemEntry)
}

function ItemFront({ card }: { card: ItemCard }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="front-content">
      {card.image && !failed ? (
        <img src={card.image} alt="Welches Item ist das?" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <div className="img-missing">Bild nicht verfügbar<br /><small>(offline noch nicht geladen)</small></div>
      )}
      <p className="hint">Tippen zum Umdrehen</p>
    </div>
  )
}

export function Learn({ deck, onExit, extraNew = 0 }: Props) {
  const [cards, setCards] = useState<Map<string, LearnEntry> | null>(null)
  const [queue, setQueue] = useState<string[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [flipped, setFlipped] = useState(false)
  const cardRef = useRef<FlashCardHandle>(null)
  const [turn, setTurn] = useState(0)
  const [sessionCount, setSessionCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const today = useLiveQuery(() => db.days.get(localDate()), [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const s = await getSettings()
      const reviews = new Map((await db.reviews.toArray()).map(r => [r.id, r]))
      const entries = await loadEntries(deck, s, reviews)
      const day = await db.days.get(localDate())
      const newLimit = extraNew > 0 ? extraNew : s.newPerDay - newIntroducedToday(day, deck)
      const q = buildQueue({ cards: entries, reviews, now: new Date(), newLimit })
      if (cancelled) return
      setSettings(s)
      setCards(new Map(entries.map(e => [e.id, e])))
      setQueue(q)
    })()
    return () => { cancelled = true }
  }, [deck, extraNew])

  const current = cards && queue.length ? cards.get(queue[0]) : undefined
  const next = cards && queue.length > 1 ? cards.get(queue[1]) : undefined

  // Nächstes Bild vorladen
  useEffect(() => {
    if (next?.image) new Image().src = next.image
  }, [next?.image])

  const handleRate = useCallback(async (known: boolean) => {
    if (!current || busy) return
    setBusy(true)
    try {
      await rateCard(current.id, known)
      setSessionCount(c => c + 1)
      setQueue(q => (known ? q.slice(1) : requeue(q, current.id)))
      setFlipped(false)
      setTurn(t => t + 1)
    } finally {
      setBusy(false)
    }
  }, [current, busy])

  // Tastatur: Leertaste/Enter = umdrehen, ←/→ = bewerten, Esc = beenden
  const hasCard = !!current
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') return onExit()
      if (!hasCard) return
      // Andere Buttons (z. B. ✕) behalten ihr normales Enter/Leertaste-Verhalten
      const onOtherButton = e.target instanceof HTMLButtonElement && !e.target.classList.contains('rate')
      if ((e.key === ' ' || e.key === 'Enter') && !onOtherButton) { e.preventDefault(); setFlipped(f => !f) }
      else if (flipped && e.key === 'ArrowRight') cardRef.current?.swipe(true)
      else if (flipped && e.key === 'ArrowLeft') cardRef.current?.swipe(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flipped, onExit, hasCard])

  if (!cards || !settings) return <div className="center muted">Lade…</div>

  const reviewedToday = today?.reviewed ?? 0
  const goalPct = Math.min(100, Math.round((reviewedToday / settings.dailyGoal) * 100))

  return (
    <div className="learn">
      <header className="learn-bar">
        <button className="icon-btn" onClick={onExit} aria-label="Beenden">✕</button>
        <div className="goal">
          <div className="goal-bar"><div style={{ width: `${goalPct}%` }} /></div>
          <span className="muted small">{reviewedToday} / {settings.dailyGoal} heute</span>
        </div>
        <span className="muted small">{queue.length} übrig</span>
      </header>

      {current ? (
        <>
          <FlashCard
            key={`${current.id}-${turn}`}
            front={current.front}
            back={current.back}
            flipped={flipped}
            onFlip={() => setFlipped(f => !f)}
            onRate={handleRate}
            ref={cardRef}
            slotClass={current.frontClass}
            frontStyle={current.frontStyle}
          />
          <div className={`rate-row${flipped ? '' : ' hidden'}`}>
            <button className="rate unknown" disabled={!flipped || busy} onClick={() => cardRef.current?.swipe(false)}>← Nicht gewusst</button>
            <button className="rate known" disabled={!flipped || busy} onClick={() => cardRef.current?.swipe(true)}>Gewusst →</button>
          </div>
        </>
      ) : (
        <div className="done">
          <h2>Fertig! 🎉</h2>
          <p>{sessionCount > 0 ? `${sessionCount} Bewertungen in dieser Session.` : 'Gerade ist nichts fällig.'}</p>
          {reviewedToday >= settings.dailyGoal && <p className="good">Tagesziel erreicht.</p>}
          <button className="primary" onClick={onExit}>Zurück</button>
        </div>
      )}
    </div>
  )
}
