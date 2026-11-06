import { createEmptyCard, fsrs, Rating, State, type Card } from 'ts-fsrs'
import { db, type DayRecord, type DeckDB, type ReviewRecord } from '../data/db'
import { addCardSoulsInTx, announceGain, type SoulsGain } from '../game/souls'
import { checkCardMilestones } from '../game/milestones'
import { checkDailyBonuses } from '../game/missions'
import { logMistakeInTx, resolveWeaknessInTx } from '../game/weakness'
import { deckOfCardId, isReverseId } from '../decks'
import { addDays, localDate } from '../data/dates'

export const scheduler = fsrs({ enable_fuzz: true, request_retention: 0.9 })

/** Lokales Datum als YYYY-MM-DD */
export { localDate } from '../data/dates'

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

export interface DeckQueueInput {
  /** Vorwärts-Karten des Decks */
  cards: { id: string; order: number }[]
  /** Rückrichtungs-Karten, die es schon geben kann (Vorwärts-Karte gelernt) */
  reverse: { id: string; order: number }[]
  reviews: Map<string, Pick<ReviewRecord, 'due'>>
  now: Date
  newLimit: number
  /** Neue Rückrichtungs-Karten (eigenes Limit) */
  reverseLimit: number
  rng?: () => number
}

/** Lernsession eines Decks: alle fälligen (beide Richtungen, älteste zuerst), dann neue, dann neue Rückrichtung */
export function buildDeckQueue({ cards, reverse, reviews, now, newLimit, reverseLimit, rng = Math.random }: DeckQueueInput): string[] {
  const due = buildQueue({ cards: [...cards, ...reverse], reviews, now, newLimit: 0, rng })
  const fresh = (list: { id: string; order: number }[], limit: number) =>
    buildQueue({ cards: list, reviews, now, newLimit: limit, rng }).filter(id => !reviews.has(id))
  return [...due, ...fresh(cards, newLimit), ...fresh(reverse, reverseLimit)]
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
  /** Meilensteine dieser Bewertung (Karte erstmals Silber/Gold, neuer Hero-Stern) */
  milestones: SoulsGain[]
}

export interface RateOptions {
  /** Bewertung im Schwächen-Training: „gewusst“ behebt die Schwäche */
  weak?: boolean
}

/** Speichert eine Bewertung (Swipe) und zählt die Karte fürs Tagesziel – jede Karte nur einmal pro Tag. */
export async function rateCard(id: string, known: boolean, now = new Date(), database: DeckDB = db, options: RateOptions = {}): Promise<RateResult> {
  let gain: SoulsGain | undefined
  const tables = [database.reviews, database.days, database.souls, database.meta, database.mistakes]
  const result = await database.transaction('rw', tables, async () => {
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
      // +10 Souls je Karte und Tag – gewusst oder nicht (ehrliches Bewerten soll sich lohnen)
      gain = await addCardSoulsInTx(database, now)
    }
    day.cards = cards
    // Schwächen: „nicht gewusst“ zählt als Fehler; „gewusst“ im Training behebt die Schwäche
    if (!known) await logMistakeInTx(database, id, 'learn', now)
    if (options.weak) {
      if (known) await resolveWeaknessInTx(database, id)
      const weak = day.weak ?? []
      if (!weak.includes(id)) weak.push(id)
      day.weak = weak
    }
    if (!existing) {
      // Tage von vor den Hero-Decks: bisherige neue Karten waren alle Items
      const byDeck = day.newByDeck ?? { items: day.newIntroduced }
      const deck = deckOfCardId(id)
      if (isReverseId(id)) {
        // Rückrichtung: eigenes Limit
        const reverse = { ...(day.newReverseByDeck ?? {}) }
        reverse[deck] = (reverse[deck] ?? 0) + 1
        day.newReverseByDeck = reverse
      } else {
        byDeck[deck] = (byDeck[deck] ?? 0) + 1
      }
      day.newByDeck = byDeck
      day.newIntroduced += 1
    }
    await database.days.put(day)
    return { wasNew, due: updated.due }
  })
  if (gain) announceGain(gain)
  // Meilensteine (Silber, Gold, Hero-Sterne), dann Tagesziel-Bonus und Tagesmissionen
  const milestones = await checkCardMilestones([id], now, database)
  await checkDailyBonuses(now, database)
  return { ...result, milestones }
}

/** Alle 7 Streak-Tage gibt es einen Streak-Schutz, höchstens 2 */
export const SHIELD_EVERY = 7
export const MAX_SHIELDS = 2

export interface StreakState {
  /** Tage in Folge mit erreichtem Tagesziel (geschützte Tage zählen nicht mit, brechen ihn aber nicht) */
  streak: number
  /** Verfügbare Streak-Schutze */
  shields: number
  /** Tage, an denen ein Schutz verbraucht wurde */
  protectedDays: string[]
  /** Längster Streak bisher (für die Statistik) */
  longest: number
}

/**
 * Streak mit Streak-Schutz, aus der Tageshistorie berechnet (auch nach einem Import korrekt):
 * erreichtes Tagesziel → Streak +1 (alle 7 Tage ein Schutz); verpasster Tag → ein Schutz wird
 * verbraucht, sonst ist der Streak weg. Heute zählt erst, wenn das Ziel erreicht ist.
 */
export function computeStreakState(days: DayRecord[], goal: number, today: Date = new Date()): StreakState {
  const met = new Set(days.filter(d => d.reviewed >= goal).map(d => d.date))
  const todayKey = localDate(today)
  const first = [...met].sort()[0]
  let streak = 0
  let shields = 0
  let longest = 0
  const protectedDays: string[] = []
  const reached = () => {
    streak++
    longest = Math.max(longest, streak)
    if (streak % SHIELD_EVERY === 0) shields = Math.min(MAX_SHIELDS, shields + 1)
  }
  for (let d = first; d !== undefined && d < todayKey; d = addDays(d, 1)) {
    if (met.has(d)) reached()
    else if (streak > 0 && shields > 0) {
      shields--
      protectedDays.push(d)
    } else streak = 0
  }
  if (met.has(todayKey)) reached()
  return { streak, shields, protectedDays, longest }
}

/** Anzahl aufeinanderfolgender Tage mit erreichtem Tagesziel (mit Streak-Schutz). */
export function computeStreak(days: DayRecord[], goal: number, today: Date = new Date()): number {
  return computeStreakState(days, goal, today).streak
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
