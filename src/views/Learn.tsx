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
import {
  baseCardId, DECKS, deckOfCardId, isReverseId, newIntroducedToday, REVERSE_NEW_PER_DAY, reverseId, reverseIdsFor, reverseIntroducedToday,
  type DeckId, type LearnDeck,
} from '../decks'
import { currentNav, pushNav, type NavState, type View } from '../nav'
import { afterRating, buildDeckQueue, buildMixedQueue, isInLearnScope, localDate, rateCard, type DeckQueueInput } from '../srs/srs'
import { checkAnswer } from '../srs/typing'
import { AnswerInput, TypedResult, type TypedAnswer } from '../components/AnswerInput'
import { ReverseFront, ReverseImage } from '../components/ReverseCards'
import { getItemPurchases, itemNewOrder, purchaseRanks } from '../data/popularity'
import type { SoulsGain } from '../game/souls'
import { MilestoneSummary } from '../components/MilestoneSummary'
import { CardNote, NoteButton, NoteSheet } from '../components/Notes'
import { ItemDetail } from './ItemDetail'

interface Props {
  /** Ein Deck oder „all“: Alles lernen (alle Decks in einer Session) */
  deck: LearnDeck
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
  /** Name der Karte (Titel beim Bearbeiten der Merkhilfe) */
  label?: string
  /** Rückrichtung: vorne der Name */
  reverse?: boolean
  /** Antwort eintippen: richtige Namen (Item: der Name, Counter: die Top 3) mit Item-IDs */
  answers?: { ids: string[]; names: string[] }
  /** Vorderseite mit Eingabefeld statt „Tippen zum Umdrehen“ */
  renderFront?: (answer: ReactNode) => ReactNode
  /** Rückseite mit markiertem eingetipptem Item (Counter) */
  renderBack?: (highlight?: string) => ReactNode
}

type ItemClick = (name: string) => void

/** onItemClick: Build-Pfad-Namen antippbar → Detailseite über der Session */
function itemEntry(card: ItemCard, onItemClick?: ItemClick, ranks: ReadonlyMap<string, number> = new Map()): LearnEntry {
  return {
    // neue Karten: meistgekauft zuerst (ohne Statistik nach Tier)
    id: card.id, label: card.name, order: itemNewOrder(card, ranks), image: card.image, frontClass: `slot-bg-${card.slot}`,
    front: <ItemFront card={card} />,
    back: <ItemBack card={card} onItemClick={onItemClick} />,
    answers: { ids: [card.id], names: [card.name] },
    renderFront: answer => <ItemFront card={card} answer={answer} />,
  }
}

function itemReverseEntry(card: ItemCard, onItemClick?: ItemClick, order = 0): LearnEntry {
  return {
    id: reverseId(card.id), label: `${card.name} (Rückrichtung)`, order, image: card.image, reverse: true,
    front: <ReverseFront name={card.name} question="Wie sieht das Item aus, was macht es?" />,
    back: <><ReverseImage src={card.image} kind="item" /><ItemBack card={card} onItemClick={onItemClick} /></>,
  }
}

function abilityEntry(card: AbilityCard): LearnEntry {
  return {
    id: card.id, label: `${card.name} (${card.heroName})`, order: card.order, image: card.image,
    front: <AbilityFront card={card} />, back: <AbilityBack card={card} />, frontStyle: heroGlow(card.heroColor),
  }
}

function abilityReverseEntry(card: AbilityCard): LearnEntry {
  return {
    id: reverseId(card.id), label: `${card.name} (Rückrichtung)`, order: card.order, image: card.image, reverse: true,
    front: <ReverseFront name={card.name} question="Wessen Fähigkeit ist das, was macht sie?" />,
    back: <><ReverseImage src={card.image} kind="ability" /><AbilityBack card={card} /></>,
  }
}

function heroEntry(card: HeroCard): LearnEntry {
  return {
    id: card.id, label: card.name, order: card.order, image: card.image,
    front: <HeroFront card={card} />, back: <HeroBack card={card} />, frontStyle: heroGlow(card.color),
  }
}

function heroReverseEntry(card: HeroCard): LearnEntry {
  return {
    id: reverseId(card.id), label: `${card.name} (Rückrichtung)`, order: card.order, image: card.image, reverse: true,
    front: <ReverseFront name={card.name} question={`Wie sieht ${card.name} aus, welche Fähigkeiten?`} />,
    back: <><ReverseImage src={card.image} kind="hero" /><HeroBack card={card} /></>,
  }
}

/** onItemClick: Counter-Items antippbar → Detailseite über der Session */
function counterEntry(card: CounterCard, items: ReadonlyMap<string, ItemCard>, onItemClick?: ItemClick): LearnEntry {
  const top = card.top.map(t => items.get(t.itemId)).filter((i): i is ItemCard => !!i)
  return {
    id: card.id, label: `Counter gegen ${card.heroName}`, order: card.order, image: card.image, frontStyle: heroGlow(card.color),
    front: <CounterFront card={card} />,
    back: <CounterBack card={card} items={items} onItemClick={onItemClick} />,
    answers: { ids: top.map(i => i.id), names: top.map(i => i.name) },
    renderFront: answer => <CounterFront card={card} answer={answer} />,
    renderBack: highlight => <CounterBack card={card} items={items} onItemClick={onItemClick} highlight={highlight} />,
  }
}

interface DeckEntries {
  normal: LearnEntry[]
  /** Rückrichtung zu schon gelernten Karten */
  reverse: LearnEntry[]
}

async function deckEntries(deck: DeckId, settings: Settings, reviews: Map<string, ReviewRecord>, onItemClick?: ItemClick): Promise<DeckEntries> {
  const reversible = (ids: string[]) => new Set(reverseIdsFor(deck, ids, reviews))
  if (deck === 'abilities') {
    const cards = await db.abilities.toArray()
    const rev = reversible(cards.map(c => c.id))
    return { normal: cards.map(abilityEntry), reverse: cards.filter(c => rev.has(reverseId(c.id))).map(abilityReverseEntry) }
  }
  if (deck === 'heroes') {
    const cards = await db.heroes.toArray()
    const rev = reversible(cards.map(c => c.id))
    return { normal: cards.map(heroEntry), reverse: cards.filter(c => rev.has(reverseId(c.id))).map(heroReverseEntry) }
  }
  const items = await db.items.toArray()
  if (deck === 'counters') {
    const byId = new Map(items.map(i => [i.id, i]))
    return { normal: (await db.counters.toArray()).map(c => counterEntry(c, byId, onItemClick)), reverse: [] }
  }
  const ranks = purchaseRanks(await getItemPurchases())
  const inScope = items.filter(i => isInLearnScope(settings.slots.includes(i.slot), reviews.get(i.id)))
  const rev = reversible(inScope.map(i => i.id))
  return {
    normal: inScope.map(i => itemEntry(i, onItemClick, ranks)),
    reverse: inScope.filter(i => rev.has(reverseId(i.id))).map(i => itemReverseEntry(i, onItemClick, itemNewOrder(i, ranks))),
  }
}

/** Bestimmte Karten aus allen Decks, auch Rückrichtung (Schwächen-Training), in der gegebenen Reihenfolge */
async function entriesForIds(ids: readonly string[], onItemClick?: ItemClick): Promise<LearnEntry[]> {
  const bases = ids.map(baseCardId)
  const of = (prefix: string) => bases.filter(id => id.startsWith(`${prefix}:`))
  const [items, abilities, heroes, counters] = await Promise.all([
    db.items.toArray(),
    db.abilities.bulkGet(of('ability')),
    db.heroes.bulkGet(of('hero')),
    db.counters.bulkGet(of('counter')),
  ])
  const itemsById = new Map(items.map(i => [i.id, i]))
  const abilityById = new Map(abilities.filter(c => c !== undefined).map(c => [c.id, c]))
  const heroById = new Map(heroes.filter(c => c !== undefined).map(c => [c.id, c]))
  const counterById = new Map(counters.filter(c => c !== undefined).map(c => [c.id, c]))
  const entryFor = (id: string): LearnEntry | undefined => {
    const base = baseCardId(id)
    const rev = isReverseId(id)
    const item = itemsById.get(base)
    if (item) return rev ? itemReverseEntry(item, onItemClick) : itemEntry(item, onItemClick)
    const ability = abilityById.get(base)
    if (ability) return rev ? abilityReverseEntry(ability) : abilityEntry(ability)
    const hero = heroById.get(base)
    if (hero) return rev ? heroReverseEntry(hero) : heroEntry(hero)
    const counter = counterById.get(base)
    return counter && !rev ? counterEntry(counter, itemsById, onItemClick) : undefined
  }
  return ids.map(entryFor).filter((e): e is LearnEntry => !!e)
}

async function loadEntries(deck: DeckId, settings: Settings, reviews: Map<string, ReviewRecord>, onItemClick?: ItemClick): Promise<DeckEntries> {
  const { normal, reverse } = await deckEntries(deck, settings, reviews, onItemClick)
  return { normal: await withPatches(normal, reviews), reverse: await withPatches(reverse, reviews) }
}

/** Patch-Hinweise an die Karten hängen (Rückrichtung: die der Vorwärts-Karte); neue Karten aus einem Patch kommen zuerst */
async function withPatches(entries: LearnEntry[], reviews: Map<string, ReviewRecord>): Promise<LearnEntry[]> {
  const patches = new Map((await db.patches.toArray()).map(p => [p.id, p]))
  const now = Date.now()
  return entries.map(e => {
    const patch = patches.get(baseCardId(e.id))
    // Neue Karten aus einem Patch vor den übrigen neuen; Badge nur, solange es gilt
    const order = newCardOrder(e.order, patch)
    return showPatchOnCard(patch, reviews.get(e.id)?.last_review, now) ? { ...e, order, patch } : { ...e, order }
  })
}

/** `answer`: Eingabefeld (Antwort eintippen) statt „Tippen zum Umdrehen“ */
function ItemFront({ card, answer }: { card: ItemCard; answer?: ReactNode }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="front-content">
      {card.image && !failed ? (
        <img src={card.image} alt="Welches Item ist das?" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <div className="img-missing">Bild nicht verfügbar<br /><small>(offline noch nicht geladen)</small></div>
      )}
      {answer ?? <p className="hint">Tippen zum Umdrehen</p>}
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
  /** Eingetippte Antwort zur aktuellen Karte (Antwort eintippen) */
  const [typed, setTyped] = useState<TypedAnswer | null>(null)
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
  // Merkhilfe bearbeiten: ebenfalls ein Verlaufseintrag (Zurück schließt nur den Editor)
  const [noteId, setNoteId] = useState<string | null>(() => currentNav().note ?? null)
  const openNote = useCallback((id: string) => {
    pushNav({ view: navView ?? { name: 'learn', deck, extraNew }, note: id })
    setNoteId(id)
  }, [deck, extraNew, navView])
  const closeNote = useCallback(() => {
    if (currentNav().note) window.history.back()
    else setNoteId(null)
  }, [])
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const state = e.state as NavState | null
      setDetailId(state?.item ?? null)
      setNoteId(state?.note ?? null)
    }
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
      } else if (deck === 'all') {
        // Alles lernen: alle Decks mit ihren eigenen Limits in einer Session
        const day = await db.days.get(localDate())
        const now = new Date()
        const decks = await Promise.all(DECKS.map(async ({ id }) => ({ id, ...(await loadEntries(id, s, reviews, onItemClick)) })))
        entries = decks.flatMap(d => [...d.normal, ...d.reverse])
        q = buildMixedQueue(decks.map((d): DeckQueueInput => ({
          cards: d.normal, reverse: d.reverse, reviews, now,
          newLimit: s.newPerDay - newIntroducedToday(day, d.id),
          reverseLimit: REVERSE_NEW_PER_DAY - reverseIntroducedToday(day, d.id),
        })))
      } else {
        const { normal, reverse } = await loadEntries(deck, s, reviews, onItemClick)
        entries = [...normal, ...reverse]
        const day = await db.days.get(localDate())
        const newLimit = extraNew > 0 ? extraNew : s.newPerDay - newIntroducedToday(day, deck)
        // Rückrichtung: eigenes Limit (bei „+10 neue“ nur normale Karten)
        const reverseLimit = extraNew > 0 ? 0 : REVERSE_NEW_PER_DAY - reverseIntroducedToday(day, deck)
        q = buildDeckQueue({ cards: normal, reverse, reviews, now: new Date(), newLimit, reverseLimit })
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

  // Antwort eintippen (Items, Counter – je Deck in den Einstellungen): Vorschlag für die Bewertung
  const allItemNames = useMemo(() => (allItems ?? []).map(i => i.name), [allItems])
  const typing = !!current?.answers?.names.length && !current.reverse && !!settings?.typeAnswers.includes(deckOfCardId(current.id))
  const suggestion = typed ? typed.correct : null
  const submitAnswer = useCallback((text: string) => {
    if (!current?.answers) return
    const { correct, match } = checkAnswer(text, current.answers.names, allItemNames)
    setTyped({ text, correct, matched: match !== undefined ? current.answers.names[match] : undefined, matchedId: match !== undefined ? current.answers.ids[match] : undefined })
    setFlipped(true)
  }, [current, allItemNames])
  const giveUp = useCallback(() => {
    setTyped({ text: '', correct: false })
    setFlipped(true)
  }, [])

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
      setTyped(null)
      setTurn(t => t + 1)
    } finally {
      setBusy(false)
    }
  }, [current, busy, queue, weakIds])

  // Tastatur: Leertaste/Enter = umdrehen, ←/→ = bewerten, Esc = beenden
  const hasCard = !!current
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Merkhilfe offen: Tasten gehören dem Editor, Esc schließt ihn
      if (noteId) {
        if (e.key === 'Escape') closeNote()
        return
      }
      // Detailseite offen: Tasten gehören ihr, Esc schließt sie
      if (detailId) {
        if (e.key === 'Escape') closeDetail()
        return
      }
      if (e.key === 'Escape') return onExit()
      if (!hasCard) return
      // Andere Buttons (z. B. ✕) behalten ihr normales Enter/Leertaste-Verhalten
      const onOtherButton = e.target instanceof HTMLButtonElement && !e.target.classList.contains('rate')
      // Nach dem Eintippen: Enter bestätigt den Vorschlag
      if (e.key === 'Enter' && flipped && suggestion !== null && !onOtherButton) { e.preventDefault(); cardRef.current?.swipe(suggestion) }
      else if ((e.key === ' ' || e.key === 'Enter') && !onOtherButton) { e.preventDefault(); setFlipped(f => !f) }
      else if (flipped && e.key === 'ArrowRight') cardRef.current?.swipe(true)
      else if (flipped && e.key === 'ArrowLeft') cardRef.current?.swipe(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flipped, onExit, hasCard, detailId, closeDetail, noteId, closeNote, suggestion])

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
            front={(
              <>
                {current.patch && <PatchBadge patch={current.patch} />}
                {typing && current.renderFront
                  ? current.renderFront(typed
                    ? <p className="typed-echo">{typed.text ? `Du: „${typed.text.trim()}“` : 'Weiß nicht'}</p>
                    : <AnswerInput placeholder={current.answers!.names.length > 1 ? 'Ein Top-Counter-Item' : 'Name des Items'} onSubmit={submitAnswer} onGiveUp={giveUp} />)
                  : current.front}
              </>
            )}
            back={(
              <>
                {typed && current.answers && <TypedResult typed={typed} answers={current.answers.names} />}
                {current.patch && <PatchNote patch={current.patch} />}
                <CardNote cardId={current.id} onEdit={() => openNote(baseCardId(current.id))} />
                {typed?.matchedId && current.renderBack ? current.renderBack(typed.matchedId) : current.back}
                <NoteButton cardId={current.id} onEdit={() => openNote(baseCardId(current.id))} />
              </>
            )}
            flipped={flipped}
            onFlip={() => setFlipped(f => !f)}
            onRate={handleRate}
            ref={cardRef}
            slotClass={current.frontClass}
            frontStyle={current.frontStyle}
          />
          <div className={`rate-row${flipped ? '' : ' hidden'}`}>
            <button className={`rate unknown${suggestion === false ? ' suggested' : ''}`} disabled={!flipped || busy}
              onClick={() => cardRef.current?.swipe(false)}>← Nicht gewusst</button>
            <button className={`rate known${suggestion === true ? ' suggested' : ''}`} disabled={!flipped || busy}
              onClick={() => cardRef.current?.swipe(true)}>Gewusst →</button>
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
      {noteId && <NoteSheet cardId={noteId} title={(cards.get(noteId) ?? cards.get(reverseId(noteId)))?.label} onClose={closeNote} />}
    </div>
  )
}
