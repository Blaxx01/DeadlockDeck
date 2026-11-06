import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { CounterBack, CounterFront } from '../components/CounterCards'
import { FlashCard, type FlashCardHandle } from '../components/FlashCard'
import { AbilityBack, AbilityFront, HeroBack, HeroFront } from '../components/HeroCards'
import { heroGlow } from '../components/heroStyle'
import { ItemBack } from '../components/ItemBack'
import { PatchBadge, PatchNote } from '../components/PatchNote'
import { db, getSettings, type ReviewRecord, type Settings } from '../data/db'
import type { AbilityCard, CounterCard, HeroCard, ItemCard } from '../data/model'
import { newCardOrder, showPatchOnCard, type PatchRecord } from '../data/patches'
import { newIntroducedToday, type DeckId } from '../decks'
import { currentNav, pushNav, type NavState, type View } from '../nav'
import { afterRating, buildQueue, isInLearnScope, localDate, rateCard } from '../srs/srs'
import { getItemPurchases, itemNewOrder, purchaseRanks } from '../data/popularity'
import type { SoulsGain } from '../game/souls'
import { MilestoneSummary } from '../components/MilestoneSummary'
import { ItemDetail } from './ItemDetail'

interface Props {
  deck: DeckId
  onExit: () => void
  /** Zusätzliche neue Karten über das Tageslimit hinaus */
  extraNew?: number
  /** Schwächen-Training: genau diese Karten (aus allen Decks), in dieser Reihenfolge */
  weakIds?: string[]
  /** Ansicht für den Verlaufseintrag der Item-Detailseite (Standard: diese Lernsession) */
  navView?: View
}

/** Eine Karte aus einem der Decks, mit allem, was die Lern-Ansicht braucht */
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
function itemEntry(card: ItemCard, onItemClick?: (name: string) => void, ranks: ReadonlyMap<string, number> = new Map()): LearnEntry {
  return {
    // neue Karten: meistgekauft zuerst (ohne Statistik nach Tier)
    id: card.id, order: itemNewOrder(card, ranks), image: card.image, frontClass: `slot-bg-${card.slot}`,
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

/** onItemClick: Counter-Items antippbar → Detailseite über der Session */
function counterEntry(card: CounterCard, items: ReadonlyMap<string, ItemCard>, onItemClick?: (name: string) => void): LearnEntry {
  return {
    id: card.id, order: card.order, image: card.image, frontStyle: heroGlow(card.color),
    front: <CounterFront card={card} />,
    back: <CounterBack card={card} items={items} onItemClick={onItemClick} />,
  }
}

async function deckEntries(deck: DeckId, settings: Settings, reviews: Map<string, ReviewRecord>, onItemClick?: (name: string) => void): Promise<LearnEntry[]> {
  if (deck === 'abilities') return (await db.abilities.toArray()).map(abilityEntry)
  if (deck === 'heroes') return (await db.heroes.toArray()).map(heroEntry)
  const items = await db.items.toArray()
  if (deck === 'counters') {
    const byId = new Map(items.map(i => [i.id, i]))
    return (await db.counters.toArray()).map(c => counterEntry(c, byId, onItemClick))
  }
  const ranks = purchaseRanks(await getItemPurchases())
  return items.filter(i => isInLearnScope(settings.slots.includes(i.slot), reviews.get(i.id))).map(i => itemEntry(i, onItemClick, ranks))
}

/** Bestimmte Karten aus allen Decks (Schwächen-Training), in der gegebenen Reihenfolge */
async function entriesForIds(ids: readonly string[], onItemClick?: (name: string) => void): Promise<LearnEntry[]> {
  const of = (prefix: string) => ids.filter(id => id.startsWith(`${prefix}:`))
  const [items, abilities, heroes, counters] = await Promise.all([
    db.items.toArray(),
    db.abilities.bulkGet(of('ability')),
    db.heroes.bulkGet(of('hero')),
    db.counters.bulkGet(of('counter')),
  ])
  const itemsById = new Map(items.map(i => [i.id, i]))
  const byId = new Map<string, LearnEntry>()
  for (const id of of('item')) {
    const card = itemsById.get(id)
    if (card) byId.set(id, itemEntry(card, onItemClick))
  }
  for (const c of abilities) if (c) byId.set(c.id, abilityEntry(c))
  for (const c of heroes) if (c) byId.set(c.id, heroEntry(c))
  for (const c of counters) if (c) byId.set(c.id, counterEntry(c, itemsById, onItemClick))
  return ids.map(id => byId.get(id)).filter((e): e is LearnEntry => !!e)
}

async function loadEntries(deck: DeckId, settings: Settings, reviews: Map<string, ReviewRecord>, onItemClick?: (name: string) => void): Promise<LearnEntry[]> {
  return withPatches(await deckEntries(deck, settings, reviews, onItemClick), reviews)
}

/** Patch-Hinweise an die Karten hängen; neue Karten aus einem Patch kommen zuerst */
async function withPatches(entries: LearnEntry[], reviews: Map<string, ReviewRecord>): Promise<LearnEntry[]> {
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

export function Learn({ deck, onExit, extraNew = 0, weakIds, navView }: Props) {
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
  /** Schwächen-Training: hier mit „gewusst“ behobene Karten */
  const [resolved, setResolved] = useState<string[]>([])
  /** Meilensteine der Session (Silber, Gold, Hero-Sterne) */
  const [achieved, setAchieved] = useState<SoulsGain[]>([])
  const today = useLiveQuery(() => db.days.get(localDate()), [])

  // Detailseite eines Items (aus dem Build-Pfad) über der Session – als Verlaufseintrag,
  // damit „Zurück“ (auch die Android-Geste) genau hierher zurückführt
  const allItems = useLiveQuery(() => db.items.toArray(), [])
  const [detailId, setDetailId] = useState<string | null>(() => currentNav().item ?? null)
  const itemsByName = useMemo(() => new Map((allItems ?? []).map(i => [i.name, i])), [allItems])
  const openItem = useCallback((id: string) => {
    pushNav({ view: navView ?? { name: 'learn', deck, extraNew }, item: id })
    setDetailId(id)
  }, [deck, extraNew, navView])
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
      let entries: LearnEntry[]
      let q: string[]
      if (weakIds) {
        // Schwächen-Training: feste Auswahl, unabhängig von Fälligkeit und Neu-Limit
        entries = await withPatches(await entriesForIds(weakIds, onItemClick), reviews)
        q = entries.map(e => e.id)
      } else {
        entries = await loadEntries(deck, s, reviews, onItemClick)
        const day = await db.days.get(localDate())
        const newLimit = extraNew > 0 ? extraNew : s.newPerDay - newIntroducedToday(day, deck)
        q = buildQueue({ cards: entries, reviews, now: new Date(), newLimit })
      }
      if (cancelled) return
      setSettings(s)
      setCards(new Map(entries.map(e => [e.id, e])))
      setQueue(q)
    })()
    return () => { cancelled = true }
  }, [deck, extraNew, onItemClick, weakIds])

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
      const result = await rateCard(current.id, known, undefined, undefined, weakIds ? { weak: true } : undefined)
      if (result.milestones.length > 0) setAchieved(a => [...a, ...result.milestones])
      if (weakIds && known) setResolved(r => (r.includes(current.id) ? r : [...r, current.id]))
      const next = afterRating(queue, current.id, known)
      setQueue(next.queue)
      if (next.deferred) setDeferred(d => d + 1)
      setRated(r => (r.includes(current.id) ? r : [...r, current.id]))
      setFlipped(false)
      setTurn(t => t + 1)
    } finally {
      setBusy(false)
    }
  }, [current, busy, queue, weakIds])

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
          {weakIds && rated.length > 0 && (
            <p className={resolved.length ? 'good' : 'muted'}>
              {resolved.length} von {rated.length} Schwächen behoben{resolved.length === rated.length ? ' 💪' : ''}
            </p>
          )}
          {deferred > 0 && !weakIds && (
            <p className="muted small">Die nicht gewusste Karte kommt in ein paar Minuten wieder – schau dann nochmal rein.</p>
          )}
          {reviewedToday >= settings.dailyGoal && <p className="good">Tagesziel erreicht.</p>}
          <MilestoneSummary gains={achieved} />
          <button className="primary" onClick={onExit}>Zurück</button>
        </div>
      )}

      {detail && allItems && (
        <ItemDetail key={detail.id} card={detail} cards={allItems} onBack={closeDetail} onOpen={openItem} backLabel="Lernsession" />
      )}
    </div>
  )
}
