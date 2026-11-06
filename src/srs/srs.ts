import { createEmptyCard, fsrs, Rating, State, type Card } from 'ts-fsrs'
import { db, type DayRecord, type DeckDB, type ReviewRecord } from '../data/db'
import { deckOfCardId } from '../decks'

export const scheduler = fsrs({ enable_fuzz: true, request_retention: 0.9 })

/** Lokales Datum als YYYY-MM-DD */
export function localDate(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export interface QueueInput {
  /** Kandidaten (bereits gefiltert); `order` bestimmt die Reihenfolge neuer Karten (z. B. Tier) */
  cards: { id: string; order: number }[]
  reviews: Map<string, Pick<ReviewRecord, 'due'>>
  now: Date
  newLimit: number
  rng?: () => number
}

/** Fällige Karten (älteste zuerst), danach neue Karten bis zum Limit (kleine `order` zuerst, sonst gemischt). */
export function buildQueue({ cards, reviews, now, newLimit, rng = Math.random }: QueueInput): string[] {
  const due = cards
    .filter(c => {
      const r = reviews.get(c.id)
      return r && r.due.getTime() <= now.getTime()
    })
    .sort((a, b) => reviews.get(a.id)!.due.getTime() - reviews.get(b.id)!.due.getTime())
    .map(c => c.id)

  const fresh = cards
    .filter(c => !reviews.has(c.id))
    .map(c => ({ ...c, r: rng() }))
    .sort((a, b) => a.order - b.order || a.r - b.r)
    .slice(0, Math.max(0, newLimit))
    .map(c => c.id)

  return [...due, ...fresh]
}

/** Wie viele Karten nach einem "nicht gewusst" dazwischen liegen, bevor sie wiederkommt. */
export const REQUEUE_GAP = 3

export function requeue(queue: string[], id: string, gap = REQUEUE_GAP): string[] {
  const rest = queue.filter(q => q !== id)
  const pos = Math.min(gap, rest.length)
  return [...rest.slice(0, pos), id, ...rest.slice(pos)]
}

/**
 * Warteschlange nach einer Bewertung.
 * Gewusst: für diese Session erledigt. Nicht gewusst: kommt nach ein paar anderen Karten wieder.
 * Ist sie die letzte, endet die Session – sofort wieder zeigen bringt nichts (die Antwort wurde
 * gerade gesehen); sie ist laut Wiederholungsplan in wenigen Minuten wieder fällig.
 */
export function afterRating(queue: string[], id: string, known: boolean): { queue: string[]; deferred: boolean } {
  const rest = queue.filter(q => q !== id)
  if (known) return { queue: rest, deferred: false }
  if (rest.length === 0) return { queue: [], deferred: true }
  return { queue: requeue(queue, id), deferred: false }
}

export function nextCard(card: Card, known: boolean, now: Date): Card {
  return scheduler.next(card, now, known ? Rating.Good : Rating.Again).card
}

export interface RateResult {
  wasNew: boolean
  due: Date
}

/** Speichert eine Bewertung (Swipe) und zählt die Karte fürs Tagesziel – jede Karte nur einmal pro Tag. */
export async function rateCard(id: string, known: boolean, now = new Date(), database: DeckDB = db): Promise<RateResult> {
  return database.transaction('rw', database.reviews, database.days, async () => {
    const existing = await database.reviews.get(id)
    const wasNew = !existing || existing.state === State.New
    const base: Card = existing ?? createEmptyCard(now)
    const updated = nextCard(base, known, now)
    // Nur die FSRS-Felder übernehmen – eine Vormerkung ist mit der Bewertung erledigt
    const record: ReviewRecord = { ...updated, id }
    delete record.requested
    await database.reviews.put(record)

    const date = localDate(now)
    const day: DayRecord = (await database.days.get(date)) ?? { date, reviewed: 0, newIntroduced: 0 }
    // Dieselbe Karte mehrfach bewerten (z. B. immer wieder „nicht gewusst“) zählt nicht mehrfach
    const cards = day.cards ?? []
    if (!cards.includes(id)) {
      cards.push(id)
      day.reviewed += 1
    }
    day.cards = cards
    if (!existing) {
      // Tage von vor den Hero-Decks: bisherige neue Karten waren alle Items
      const byDeck = day.newByDeck ?? { items: day.newIntroduced }
      const deck = deckOfCardId(id)
      byDeck[deck] = (byDeck[deck] ?? 0) + 1
      day.newByDeck = byDeck
      day.newIntroduced += 1
    }
    await database.days.put(day)
    return { wasNew, due: updated.due }
  })
}

/** Anzahl aufeinanderfolgender Tage mit erreichtem Tagesziel. Heute zählt mit, wenn erreicht; sonst ab gestern. */
export function computeStreak(days: DayRecord[], goal: number, today: Date = new Date()): number {
  const met = new Set(days.filter(d => d.reviewed >= goal).map(d => d.date))
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (!met.has(localDate(cursor))) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (met.has(localDate(cursor))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

/**
 * „Jetzt lernen“: Karte wird sofort fällig und kommt in die nächste Session.
 * Zählt nicht gegen das Neu-Limit; der bisherige Lernverlauf bleibt erhalten.
 */
export async function requestLearn(id: string, now = new Date(), database: DeckDB = db): Promise<void> {
  await database.transaction('rw', database.reviews, async () => {
    const existing = await database.reviews.get(id)
    const base: Card = existing ?? createEmptyCard(now)
    await database.reviews.put({ ...base, id, due: now, requested: true })
  })
}

/** Gehört die Karte in Lern-Sessions? Kategorie-Filter, außer sie wurde ausdrücklich vorgemerkt. */
export function isInLearnScope(slotEnabled: boolean, review?: Pick<ReviewRecord, 'requested'>): boolean {
  return slotEnabled || !!review?.requested
}

export interface LearnState {
  label: string
  /** z. B. „nächste Wiederholung in 3 Tagen“ */
  detail?: string
}

/** Lernstand einer Karte für die Anzeige. */
export function describeLearnState(review: ReviewRecord | undefined, now = new Date()): LearnState {
  if (review?.requested) return { label: 'Vorgemerkt', detail: 'kommt in der nächsten Lern-Session dran' }
  if (!review || review.state === State.New) return { label: 'Neu', detail: 'noch nicht gelernt' }
  const reps = `${review.reps}× wiederholt`
  const due = review.due.getTime() <= now.getTime() ? 'jetzt fällig' : `nächste Wiederholung ${formatRelative(review.due, now)}`
  if (review.state === State.Review) return { label: 'Gelernt', detail: `${due} · ${reps}` }
  return { label: 'Wird gelernt', detail: `${due} · ${reps}` }
}

/** „in 10 Min.“, „in 3 Std.“, „morgen“, „in 5 Tagen“, „in 3 Wochen“, „in 2 Monaten“ */
export function formatRelative(date: Date, now = new Date()): string {
  const minutes = Math.round((date.getTime() - now.getTime()) / 60_000)
  if (minutes < 60) return `in ${Math.max(1, minutes)} Min.`
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000)
  if (days === 0) return `in ${Math.round(minutes / 60)} Std.`
  if (days === 1) return 'morgen'
  if (days < 14) return `in ${days} Tagen`
  if (days < 60) return `in ${Math.round(days / 7)} Wochen`
  return `in ${Math.round(days / 30)} Monaten`
}
