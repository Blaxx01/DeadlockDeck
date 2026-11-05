import type { DayRecord } from './data/db'

export type DeckId = 'items' | 'abilities' | 'heroes'

export const DECKS: { id: DeckId; label: string }[] = [
  { id: 'items', label: 'Items' },
  { id: 'abilities', label: 'Fähigkeiten' },
  { id: 'heroes', label: 'Heroes' },
]

export function deckLabel(id: DeckId): string {
  return DECKS.find(d => d.id === id)?.label ?? id
}

/** "item:…" → items, "ability:…" → abilities, "hero:…" → heroes */
export function deckOfCardId(cardId: string): DeckId {
  const prefix = cardId.split(':')[0]
  if (prefix === 'ability') return 'abilities'
  if (prefix === 'hero') return 'heroes'
  return 'items'
}

/** Heute eingeführte neue Karten eines Decks (für das Neu-Limit je Deck). */
export function newIntroducedToday(day: DayRecord | undefined, deck: DeckId): number {
  if (!day) return 0
  if (day.newByDeck) return day.newByDeck[deck] ?? 0
  // Tage von vor den Hero-Decks: alle neuen Karten waren Items
  return deck === 'items' ? day.newIntroduced : 0
}
