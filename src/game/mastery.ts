/**
 * Meisterschaft einer Karte – aus dem Abstand, den das Lernsystem bei der letzten Wiederholung gewählt hat
 * (`scheduled_days`; „Jetzt lernen“ und Patch-Fälligkeit ändern ihn nicht):
 * Bronze = gelernt, Silber = nächste Wiederholung in ≥ 3 Wochen, Gold = in ≥ 2 Monaten.
 */
import { State } from 'ts-fsrs'
import type { ReviewRecord } from '../data/db'

export type Mastery = 'none' | 'bronze' | 'silver' | 'gold'

export const SILVER_DAYS = 21
export const GOLD_DAYS = 60

export const MASTERY_ORDER: Record<Mastery, number> = { none: 0, bronze: 1, silver: 2, gold: 3 }

export const MASTERY_LABEL: Record<Mastery, string> = {
  none: 'Neu',
  bronze: 'Bronze',
  silver: 'Silber',
  gold: 'Gold',
}

/** Medaille als zweites Merkmal neben der Farbe */
export const MASTERY_MEDAL: Record<Mastery, string> = {
  none: '',
  bronze: '🥉',
  silver: '🥈',
  gold: '🥇',
}

/** Was es bis zur nächsten Stufe braucht */
export const MASTERY_NEXT: Record<Mastery, string> = {
  none: 'Bronze, sobald du sie gelernt hast',
  bronze: 'Silber, wenn die nächste Wiederholung mind. 3 Wochen entfernt ist',
  silver: 'Gold, wenn die nächste Wiederholung mind. 2 Monate entfernt ist',
  gold: 'höchste Stufe',
}

export function masteryOf(review?: Pick<ReviewRecord, 'state' | 'scheduled_days'>): Mastery {
  if (!review || review.state === State.New) return 'none'
  if (review.scheduled_days >= GOLD_DAYS) return 'gold'
  if (review.scheduled_days >= SILVER_DAYS) return 'silver'
  return 'bronze'
}

export function atLeast(level: Mastery, min: Mastery): boolean {
  return MASTERY_ORDER[level] >= MASTERY_ORDER[min]
}

export interface MasteryCounts {
  total: number
  /** mindestens Bronze */
  learned: number
  /** mindestens Silber */
  silver: number
  gold: number
}

export function countMastery(ids: readonly string[], reviews: ReadonlyMap<string, Pick<ReviewRecord, 'state' | 'scheduled_days'>>): MasteryCounts {
  const counts: MasteryCounts = { total: ids.length, learned: 0, silver: 0, gold: 0 }
  for (const id of ids) {
    const level = masteryOf(reviews.get(id))
    if (atLeast(level, 'bronze')) counts.learned++
    if (atLeast(level, 'silver')) counts.silver++
    if (level === 'gold') counts.gold++
  }
  return counts
}

/** Text für Screenreader: „3 Gold, 5 Silber, 2 Bronze, 48 neu“ */
export function masteryText(counts: MasteryCounts): string {
  return `${counts.gold} Gold, ${counts.silver - counts.gold} Silber, ${counts.learned - counts.silver} Bronze, ${counts.total - counts.learned} neu`
}
