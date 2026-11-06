import { describe, expect, it } from 'vitest'
import { itemPurchases } from './counters'
import { itemNewOrder, purchaseRanks, WITHOUT_STATS } from './popularity'
import { item, stat } from '../test/counterFixtures'

describe('Items nach Beliebtheit', () => {
  const items = [item(1, 'Alpha'), item(2, 'Beta', 'weapon', { tier: 3 }), item(3, 'Gamma', 'weapon', { tier: 1 }), item(4, 'Delta')]

  it('zählt Käufe je Item, unbekannte API-IDs fallen weg', () => {
    expect(itemPurchases([stat(1, 500), stat(2, 9000), stat(1, 700), stat(99, 5)], items)).toEqual({ 'item:alpha': 1200, 'item:beta': 9000 })
  })

  it('meistgekauft zuerst; ohne Kaufzahlen danach, untereinander nach Tier', () => {
    const ranks = purchaseRanks({ 'item:alpha': 1200, 'item:beta': 9000 })
    expect(items.map(i => itemNewOrder(i, ranks))).toEqual([1, 0, WITHOUT_STATS + 1, WITHOUT_STATS + 2])
    // ohne Statistik: wie bisher nach Tier
    expect(items.map(i => itemNewOrder(i, new Map()))).toEqual([WITHOUT_STATS + 2, WITHOUT_STATS + 3, WITHOUT_STATS + 1, WITHOUT_STATS + 2])
  })
})
