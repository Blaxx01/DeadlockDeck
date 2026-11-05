import { SLOT_LABEL, type ItemCard, type SlotType } from '../data/model'

/** Kleinschreibung, ohne Akzente/Umlaut-Punkte: „Fähigkeit“ findet man auch mit „fahigkeit“. */
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function stripHtml(html: string): string {
  return html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ')
}

/** Alles, was die Suche durchsucht: Name, Kategorie, Effekttexte, Stat-Namen. */
export function searchableText(card: ItemCard): string {
  const parts = [
    card.name,
    SLOT_LABEL[card.slot],
    ...card.sections.map(s => (s.html ? stripHtml(s.html) : '')),
    ...card.sections.flatMap(s => s.stats.map(st => st.label)),
    ...card.timings.map(t => t.label),
  ]
  return normalizeText(parts.join(' '))
}

const SLOT_ORDER: Record<SlotType, number> = { weapon: 0, vitality: 1, spirit: 2 }

/**
 * Findet Items, deren Text alle Suchwörter enthält. Treffer im Namen zuerst,
 * danach wie im Shop sortiert (Kategorie, Tier, Name).
 */
export function searchItems(cards: readonly ItemCard[], query: string): ItemCard[] {
  const words = normalizeText(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const scored: { card: ItemCard; nameHit: boolean }[] = []
  for (const card of cards) {
    const text = searchableText(card)
    if (!words.every(w => text.includes(w))) continue
    const name = normalizeText(card.name)
    scored.push({ card, nameHit: words.every(w => name.includes(w)) })
  }
  return scored
    .sort((a, b) =>
      Number(b.nameHit) - Number(a.nameHit)
      || SLOT_ORDER[a.card.slot] - SLOT_ORDER[b.card.slot]
      || a.card.tier - b.card.tier
      || a.card.name.localeCompare(b.card.name))
    .map(s => s.card)
}

/** Items einer Kategorie, gruppiert nach Tier und alphabetisch – wie im Ingame-Shop. */
export function shopTiers(cards: readonly ItemCard[], slot: SlotType): { tier: number; price?: number; items: ItemCard[] }[] {
  const bySlot = cards.filter(c => c.slot === slot)
  const tiers = [...new Set(bySlot.map(c => c.tier))].sort((a, b) => a - b)
  return tiers.map(tier => {
    const items = bySlot.filter(c => c.tier === tier).sort((a, b) => a.name.localeCompare(b.name))
    return { tier, price: mostCommon(items.map(i => i.cost).filter(c => c > 0)), items }
  })
}

function mostCommon(values: number[]): number | undefined {
  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: number | undefined
  let bestCount = 0
  for (const [v, n] of counts) {
    if (n > bestCount) {
      best = v
      bestCount = n
    }
  }
  return best
}
