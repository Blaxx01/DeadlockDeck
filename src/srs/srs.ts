import { createEmptyCard, fsrs, Rating, State, type Card } from 'ts-fsrs'
import { db, type DayRecord, type DeckDB, type ReviewRecord } from '../data/db'

export const scheduler = fsrs({ enable_fuzz: true, request_retention: 0.9 })

/** Lokales Datum als YYYY-MM-DD */
export function localDate(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export interface QueueInput {
  /** Kandidaten (bereits nach Filter), sortiert nach gewünschter Reihenfolge für neue Karten */
  cards: { id: string; tier: number }[]
  reviews: Map<string, Pick<ReviewRecord, 'due'>>
  now: Date
  newLimit: number
  rng?: () => number
}

/** Fällige Karten (älteste zuerst), danach neue Karten bis zum Limit (niedrige Tiers zuerst, sonst gemischt). */
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
    .sort((a, b) => a.tier - b.tier || a.r - b.r)
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

export function nextCard(card: Card, known: boolean, now: Date): Card {
  return scheduler.next(card, now, known ? Rating.Good : Rating.Again).card
}

export interface RateResult {
  wasNew: boolean
  due: Date
}

/** Speichert eine Bewertung (Swipe) und zählt sie für das Tagesziel. */
export async function rateCard(id: string, known: boolean, now = new Date(), database: DeckDB = db): Promise<RateResult> {
  return database.transaction('rw', database.reviews, database.days, async () => {
    const existing = await database.reviews.get(id)
    const wasNew = !existing || existing.state === State.New
    const base: Card = existing ?? createEmptyCard(now)
    const updated = nextCard(base, known, now)
    await database.reviews.put({ ...updated, id })

    const date = localDate(now)
    const day = (await database.days.get(date)) ?? { date, reviewed: 0, newIntroduced: 0 }
    day.reviewed += 1
    if (!existing) day.newIntroduced += 1
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
