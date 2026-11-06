import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { FlashCard, type FlashCardHandle } from '../components/FlashCard'
import { AbilityBack, AbilityFront, HeroBack, HeroFront } from '../components/HeroCards'
import { heroGlow } from '../components/heroStyle'
import { ItemBack } from '../components/ItemBack'
import { PatchBadge, PatchNote } from '../components/PatchNote'
import { db, getSettings, type ReviewRecord, type Settings } from '../data/db'
import type { AbilityCard, HeroCard, ItemCard } from '../data/model'
import { newCardOrder, showPatchOnCard, type PatchRecord } from '../data/patches'
import { newIntroducedToday, type DeckId } from '../decks'
import { currentNav, pushNav, type NavState } from '../nav'
import { afterRating, buildQueue, isInLearnScope, localDate, rateCard } from '../srs/srs'
import { ItemDetail } from './ItemDetail'

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
  /** Geändert/neu im Patch und seitdem noch nicht wiederholt */
  patch?: PatchRecord
}

/** onItemClick: Build-Pfad-Namen antippbar → Detailseite über der Session */
function itemEntry(card: ItemCard, onItemClick?: (name: string) => void): LearnEntry {
  return {
    id: card.id, order: card.tier, image: card.image, frontClass: `slot-bg-${card.slot}`,
    front: <ItemFront card={card} />,
    back: <ItemBack card={card} onItemClick={onItemClick} />,
  }
}

function abilityEntry(card: AbilityCard): LearnEntry {
  return { id: card.id, order: card.order, image: card.image, front: <AbilityFront card={card} />, back: <AbilityBack card={card} />, frontStyle: heroGlow(card.heroColor) }
}

function heroEntry(card: HeroCard): LearnEntry {
  return { id: card.id, order: card.order, image: card.image, front: <HeroFront card={card} />, back: <HeroBack card={card} />, frontStyle: heroGlow(card.color) }
}

async function deckEntries(deck: DeckId, settings: Settings, reviews: Map<string, ReviewRecord>, onItemClick?: (name: string) => void): Promise<LearnEntry[]> {
  if (deck === 'abilities') return (await db.abilities.toArray()).map(abilityEntry)
  if (deck === 'heroes') return (await db.heroes.toArray()).map(heroEntry)
  const items = await db.items.toArray()
  return items.filter(i => isInLearnScope(settings.slots.includes(i.slot), reviews.get(i.id))).map(i => itemEntry(i, onItemClick))
}

async function loadEntries(deck: DeckId, settings: Settings, reviews: Map<string, ReviewRecord>, onItemClick?: (name: string) => void): Promise<LearnEntry[]> {
  const entries = await deckEntries(deck, settings, reviews, onItemClick)
  const patches = new Map((await db.patches.toArray()).map(p => [p.id, p]))
  const now = Date.now()
  return entries.map(e => {
    const patch = patches.get(e.id)
    // Neue Karten aus einem Patch vor den übrigen neuen; Badge nur, solange es gilt
    const order = newCardOrder(e.order, patch)
    return showPatchOnCard(patch, reviews.get(e.id)?.last_review, now) ? { ...e, order, patch } : { ...e, order }
  })
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
  /** In dieser Session bewertete Karten (jede einmal) */
  const [rated, setRated] = useState<string[]>([])
  /** Nicht gewusste letzte Karten, die erst in ein paar Minuten wieder fällig sind */
  const [deferred, setDeferred] = useState(0)
  const [busy, setBusy] = useState(false)
  const today = useLiveQuery(() => db.days.get(localDate()), [])

  // Detailseite eines Items (aus dem Build-Pfad) über der Session – als Verlaufseintrag,
  // damit „Zurück“ (auch die Android-Geste) genau hierher zurückführt
  const allItems = useLiveQuery(() => db.items.toArray(), [])
  const [detailId, setDetailId] = useState<string | null>(() => currentNav().item ?? null)
  const itemsByName = useMemo(() => new Map((allItems ?? []).map(i => [i.name, i])), [allItems])
  const openItem = useCallback((id: string) => {
    pushNav({ view: { name: 'learn', deck, extraNew }, item: id })
    setDetailId(id)
  }, [deck, extraNew])
  const closeDetail = useCallback(() => {
    if (currentNav().item) window.history.back()
    else setDetailId(null)
  }, [])
  useEffect(() => {
    const onPop = (e: PopStateEvent) => setDetailId((e.state as NavState | null)?.item ?? null)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  // Stabiler Klick-Handler für die Karten (die Karten werden einmal pro Session gebaut)
  const openByName = useRef<(name: string) => void>(() => {})
  useEffect(() => {
    openByName.current = name => {
      const item = itemsByName.get(name)
      if (item) openItem(item.id)
    }
  }, [itemsByName, openItem])
  const onItemClick = useCallback((name: string) => openByName.current(name), [])
  const detail = detailId && allItems ? allItems.find(i => i.id === detailId) : undefined

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const s = await getSettings()
      const reviews = new Map((await db.reviews.toArray()).map(r => [r.id, r]))
      const entries = await loadEntries(deck, s, reviews, onItemClick)
      const day = await db.days.get(localDate())
      const newLimit = extraNew > 0 ? extraNew : s.newPerDay - newIntroducedToday(day, deck)
      const q = buildQueue({ cards: entries, reviews, now: new Date(), newLimit })
      if (cancelled) return
      setSettings(s)
      setCards(new Map(entries.map(e => [e.id, e])))
      setQueue(q)
    })()
    return () => { cancelled = true }
  }, [deck, extraNew, onItemClick])

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
      const next = afterRating(queue, current.id, known)
      setQueue(next.queue)
      if (next.deferred) setDeferred(d => d + 1)
      setRated(r => (r.includes(current.id) ? r : [...r, current.id]))
      setFlipped(false)
      setTurn(t => t + 1)
    } finally {
      setBusy(false)
    }
  }, [current, busy, queue])

  // Tastatur: Leertaste/Enter = umdrehen, ←/→ = bewerten, Esc = beenden
  const hasCard = !!current
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Detailseite offen: Tasten gehören ihr, Esc schließt sie
      if (detailId) {
        if (e.key === 'Escape') closeDetail()
        return
      }
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
  }, [flipped, onExit, hasCard, detailId, closeDetail])

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
            front={<>{current.patch && <PatchBadge patch={current.patch} />}{current.front}</>}
            back={<>{current.patch && <PatchNote patch={current.patch} />}{current.back}</>}
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
          <p>{rated.length > 0 ? `${rated.length} ${rated.length === 1 ? 'Karte' : 'Karten'} in dieser Session.` : 'Gerade ist nichts fällig.'}</p>
          {deferred > 0 && (
            <p className="muted small">Die nicht gewusste Karte kommt in ein paar Minuten wieder – schau dann nochmal rein.</p>
          )}
          {reviewedToday >= settings.dailyGoal && <p className="good">Tagesziel erreicht.</p>}
          <button className="primary" onClick={onExit}>Zurück</button>
        </div>
      )}

      {detail && allItems && (
        <ItemDetail key={detail.id} card={detail} cards={allItems} onBack={closeDetail} onOpen={openItem} backLabel="Lernsession" />
      )}
    </div>
  )
}
