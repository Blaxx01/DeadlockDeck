// Testdaten für Counter-Berechnung, -Sync und -Quiz
import type { ApiItemStat } from '../data/counters'
import type { HeroCard, ItemCard, SlotType } from '../data/model'

export function item(apiId: number, name: string, slot: SlotType = 'weapon', extra: Partial<ItemCard> = {}): ItemCard {
  const cls = name.toLowerCase().replace(/\W+/g, '_')
  return {
    id: `item:${cls}`, apiId, className: cls, name, slot, tier: 2, cost: 1600, isActive: false,
    image: `https://cdn.example/${cls}.png`, timings: [], sections: [], buildsFrom: [], upgradesTo: [], fingerprint: '',
    ...extra,
  }
}

export function hero(heroId: number, name: string): HeroCard {
  const cls = `hero_${name.toLowerCase()}`
  return {
    id: `hero:${cls}`, heroId, className: cls, name, order: heroId, image: `https://cdn.example/${cls}.png`,
    smallImage: `https://cdn.example/${cls}_small.png`, poses: [], tags: [], stats: [], abilities: [], fingerprint: '',
  }
}

/** Zeile der API-Statistik */
export function stat(itemId: number, matches: number, bucket = 0): ApiItemStat {
  return { item_id: itemId, bucket, matches, wins: Math.round(matches / 2), losses: matches - Math.round(matches / 2) }
}
