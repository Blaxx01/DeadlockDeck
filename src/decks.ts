import { State } from 'ts-fsrs'
import type { DayRecord, ReviewRecord } from './data/db'

export type DeckId = 'items' | 'abilities' | 'heroes' | 'counters'

/** Was eine Lernsession lernt: ein Deck oder „Alles lernen“ (alle Decks in einer Session) */
export type LearnDeck = DeckId | 'all'

export const DECKS: { id: DeckId; label: string }[] = [
  { id: 'items', label: 'Items' },
  { id: 'abilities', label: 'Fähigkeiten' },
  { id: 'heroes', label: 'Heroes' },
  { id: 'counters', label: 'Counter' },
]

export function deckLabel(id: DeckId): string {
  return DECKS.find(d => d.id === id)?.label ?? id
}

/** "item:…" → items, "ability:…" → abilities, "hero:…" → heroes, "counter:…" → counters */
export function deckOfCardId(cardId: string): DeckId {
  const prefix = cardId.split(':')[0]
  if (prefix === 'ability') return 'abilities'
  if (prefix === 'hero') return 'heroes'
  if (prefix === 'counter') return 'counters'
  return 'items'
}

/** Heute eingeführte neue Karten eines Decks (für das Neu-Limit je Deck). */
export function newIntroducedToday(day: DayRecord | undefined, deck: DeckId): number {
  if (!day) return 0
  if (day.newByDeck) return day.newByDeck[deck] ?? 0
  // Tage von vor den Hero-Decks: alle neuen Karten waren Items
  return deck === 'items' ? day.newIntroduced : 0
}

/** Rückrichtung: eigene Karte „Name → Bild und Wirkung“ mit eigener ID (Vorwärts-ID + Endung) */
export const REVERSE_SUFFIX = '~r'
/** Decks mit Rückrichtung */
export const REVERSE_DECKS: readonly DeckId[] = ['items', 'abilities', 'heroes']
/** Neue Rückrichtungs-Karten pro Tag und Deck – zusätzlich zum normalen Neu-Limit */
export const REVERSE_NEW_PER_DAY = 5

export function reverseId(cardId: string): string {
  return `${cardId}${REVERSE_SUFFIX}`
}

export function isReverseId(cardId: string): boolean {
  return cardId.endsWith(REVERSE_SUFFIX)
}

/** Vorwärts-Karte zu einer Karten-ID (bei Vorwärts-Karten die ID selbst) */
export function baseCardId(cardId: string): string {
  return isReverseId(cardId) ? cardId.slice(0, -REVERSE_SUFFIX.length) : cardId
}

/**
 * Rückrichtungs-Karten, die es geben kann: zu Vorwärts-Karten, die wirklich gelernt sind – die Lernphase einmal
 * geschafft haben (Wiederholung bzw. danach wieder vergessen), nicht schon direkt nach der ersten Bewertung.
 */
export function reverseIdsFor(deck: DeckId, ids: readonly string[], reviews: ReadonlyMap<string, Pick<ReviewRecord, 'state'>>): string[] {
  if (!REVERSE_DECKS.includes(deck)) return []
  return ids.filter(id => {
    const state = reviews.get(id)?.state
    return state === State.Review || state === State.Relearning
  }).map(reverseId)
}

/** Heute eingeführte neue Rückrichtungs-Karten eines Decks */
export function reverseIntroducedToday(day: DayRecord | undefined, deck: DeckId): number {
  return day?.newReverseByDeck?.[deck] ?? 0
}
