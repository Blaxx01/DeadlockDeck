/**
 * Statistik-Seite: Kalender der Lerntage, Souls-Verlauf, Kennzahlen (reine Funktionen).
 */
import { addDays, parseLocalDate } from '../data/dates'
import type { DayRecord } from '../data/db'
import type { SoulsEntry } from './souls'

export const CALENDAR_WEEKS = 20

/** Kalender-Stufe: 0 = nicht gelernt, 1 = gelernt, 2 = Tagesziel, 3 = doppeltes Tagesziel */
export type DayLevel = 0 | 1 | 2 | 3

export function dayLevel(reviewed: number, goal: number): DayLevel {
  if (reviewed <= 0) return 0
  if (reviewed >= 2 * goal) return 3
  if (reviewed >= goal) return 2
  return 1
}

export interface CalendarDay {
  date: string
  reviewed: number
  level: DayLevel
  /** An diesem Tag wurde ein Streak-Schutz verbraucht */
  shielded: boolean
  /** Liegt nach heute (bleibt leer) */
  future: boolean
}

/** Montag der Woche (lokales Datum) */
export function weekStart(date: string): string {
  return addDays(date, -((parseLocalDate(date).getDay() + 6) % 7))
}

/** Die letzten `weeks` Wochen (Montag–Sonntag) bis einschließlich der aktuellen, älteste zuerst */
export function calendarWeeks(
  days: readonly Pick<DayRecord, 'date' | 'reviewed'>[],
  goal: number,
  today: string,
  protectedDays: readonly string[] = [],
  weeks = CALENDAR_WEEKS,
): CalendarDay[][] {
  const reviewedOn = new Map(days.map(d => [d.date, d.reviewed]))
  const shielded = new Set(protectedDays)
  const start = addDays(weekStart(today), -7 * (weeks - 1))
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = addDays(start, w * 7 + d)
      const reviewed = reviewedOn.get(date) ?? 0
      return { date, reviewed, level: dayLevel(reviewed, goal), shielded: shielded.has(date), future: date > today }
    }),
  )
}

export interface SoulsPoint {
  date: string
  /** Stand am Ende des Tages */
  total: number
  /** Änderung an diesem Tag */
  delta: number
}

/** Souls-Stand am Ende jedes Tages – vom ersten Eintrag bis heute */
export function soulsSeries(entries: readonly Pick<SoulsEntry, 'date' | 'amount'>[], today: string): SoulsPoint[] {
  const perDay = new Map<string, number>()
  for (const e of entries) perDay.set(e.date, (perDay.get(e.date) ?? 0) + e.amount)
  const first = [...perDay.keys()].sort()[0]
  if (!first || first > today) return []
  const points: SoulsPoint[] = []
  let total = 0
  for (let date = first; date <= today; date = addDays(date, 1)) {
    const delta = perDay.get(date) ?? 0
    total += delta
    points.push({ date, total, delta })
  }
  return points
}

/** „Schöne“ Achsen-Schritte (1, 2, 5 × 10ⁿ), sodass `max` in `ticks` Schritte passt */
export function niceStep(max: number, ticks = 3): number {
  if (max <= 0) return 1
  const raw = max / ticks
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map(m => m * pow).find(s => s >= raw) ?? 10 * pow
  return Math.max(1, step)
}

export interface LearningTotals {
  /** Tage mit mindestens einer bewerteten Karte */
  learningDays: number
  /** Tage mit erreichtem Tagesziel */
  goalDays: number
  /** Bewertete Karten insgesamt (je Karte und Tag einmal) */
  reviews: number
}

export function learningTotals(days: readonly Pick<DayRecord, 'reviewed'>[], goal: number): LearningTotals {
  return {
    learningDays: days.filter(d => d.reviewed > 0).length,
    goalDays: days.filter(d => d.reviewed >= goal).length,
    reviews: days.reduce((sum, d) => sum + d.reviewed, 0),
  }
}

/** „Mi., 5. Nov.“ */
export function formatDay(date: string): string {
  return parseLocalDate(date).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })
}

function cards(n: number): string {
  return `${n.toLocaleString('de-DE')} ${n === 1 ? 'Karte' : 'Karten'}`
}

/** „Mi., 5. Nov.: 23 Karten · Tagesziel ✓“ */
export function describeDay(d: CalendarDay, goal: number): string {
  const parts = [`${formatDay(d.date)}: ${cards(d.reviewed)}`]
  if (d.reviewed >= goal) parts.push('Tagesziel ✓')
  if (d.shielded) parts.push('🛡 Streak-Schutz verbraucht')
  return parts.join(' · ')
}
