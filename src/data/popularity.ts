/**
 * Items nach Beliebtheit: neue Item-Karten kommen meistgekauft zuerst (Käufe in Matches ab Orakel,
 * letzte 30 Tage – aus derselben Abfrage wie die Counter-Daten). Ohne Statistik wie bisher nach Tier.
 */
import { db, getMeta, type DeckDB } from './db'
import type { ItemCard } from './model'

/** Items ohne Kaufzahlen kommen nach allen anderen (untereinander nach Tier) */
export const WITHOUT_STATS = 10_000

export async function getItemPurchases(database: DeckDB = db): Promise<Record<string, number>> {
  return getMeta<Record<string, number>>('itemPurchases', {}, database)
}

/** Platz je Item (0 = meistgekauft) */
export function purchaseRanks(purchases: Readonly<Record<string, number>>): Map<string, number> {
  return new Map(Object.entries(purchases).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id], i) => [id, i]))
}

/** Reihenfolge einer neuen Item-Karte (kleiner = früher) */
export function itemNewOrder(item: Pick<ItemCard, 'id' | 'tier'>, ranks: ReadonlyMap<string, number>): number {
  return ranks.get(item.id) ?? WITHOUT_STATS + item.tier
}
