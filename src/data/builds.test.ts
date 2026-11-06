import { describe, expect, it } from 'vitest'
import { hero, item } from '../test/counterFixtures'
import {
  buildCommunityRecord, buildSize, computeTypicalBuilds, MAX_COMMUNITY_ITEMS, MIN_HERO_MATCHES, pickTopBuild, sectionTitle,
  TYPICAL_SIZE, type ApiBuild,
} from './builds'
import type { ApiItemStat } from './counters'

const ITEMS = Array.from({ length: 40 }, (_, i) => item(i + 1, `Item ${i + 1}`))
const HAZE = hero(13, 'Haze')

/** Item-Statistik eines Heroes: Käufe + ⌀ Kaufzeit */
function row(itemId: number, matches: number, buyTime: number, heroId = 13): ApiItemStat {
  return { item_id: itemId, bucket: heroId, matches, wins: 0, losses: 0, avg_buy_time_s: buyTime }
}

describe('computeTypicalBuilds', () => {
  // 20 Items: je mehr Käufe, desto kleiner die ID; Kaufzeit steigt mit der ID (umgekehrt)
  const rows = Array.from({ length: 20 }, (_, i) => row(i + 1, 9000 - i * 100, 1500 - i * 70))
  const stats = [{ hero_id: 13, matches: 10_000 }]

  it('nimmt die 16 meistgekauften Items, sortiert nach Kaufzeit, in Früh/Mitte/Spät', () => {
    const [build, ...rest] = computeTypicalBuilds([...rows, row(999, 9999, 10)], stats, ITEMS, [HAZE], 7)
    expect(rest).toHaveLength(0)
    expect(build).toMatchObject({ id: 'typical:hero_haze', source: 'typical', heroId: 13, heroName: 'Haze', updatedAt: 7 })
    expect(buildSize(build)).toBe(TYPICAL_SIZE)
    const ids = build.sections.flatMap(s => s.items.map(i => i.itemId))
    // Items 1–16 (die meisten Käufe), früheste Kaufzeit zuerst → Item 16 (450 s) vorn, Item 1 (1500 s) hinten
    expect(ids[0]).toBe('item:item_16')
    expect(ids.at(-1)).toBe('item:item_1')
    expect(ids).not.toContain('item:item_17')
    // Kaufzeiten 450–1500 s: Früh < 600 s (Items 14–16), Mitte bis 1200 s (6–13), Spät ab 1200 s (1–5)
    expect(build.sections.map(s => [s.title, s.items.length])).toEqual([['Früh', 3], ['Mitte', 8], ['Spät', 5]])
    expect(build.sections[2].items.at(-1)).toEqual({ itemId: 'item:item_1', pick: 0.9, buyTime: 1500 })
  })

  it('überspringt Heroes mit zu wenig Matches oder zu wenig Items', () => {
    expect(computeTypicalBuilds(rows, [{ hero_id: 13, matches: MIN_HERO_MATCHES - 1 }], ITEMS, [HAZE], 0)).toEqual([])
    expect(computeTypicalBuilds(rows.slice(0, TYPICAL_SIZE - 1), stats, ITEMS, [HAZE], 0)).toEqual([])
  })
})

describe('sectionTitle', () => {
  it('übersetzt Platzhalter und lässt eigene Namen stehen', () => {
    expect(sectionTitle('#Citadel_HeroBuilds_EarlyGame')).toBe('Früh')
    expect(sectionTitle('#Citadel_HeroBuilds_MidGame')).toBe('Mitte')
    expect(sectionTitle('#Citadel_HeroBuilds_LateGame')).toBe('Spät')
    expect(sectionTitle('#Citadel_HeroBuilds_Lane')).toBe('Lane')
    expect(sectionTitle('#Citadel_HeroBuilds_SomethingNew')).toBe('Something New')
    expect(sectionTitle('You have Ascended')).toBe('You have Ascended')
    expect(sectionTitle('  ')).toBe('Weitere Items')
    expect(sectionTitle('x'.repeat(60))).toHaveLength(48)
  })
})

describe('pickTopBuild', () => {
  it('nimmt den meistgespielten Build mit seinem Anteil', () => {
    expect(pickTopBuild([
      { hero_build_id: 1, matches: 100 }, { hero_build_id: 2, matches: 300 }, { hero_build_id: 3, matches: 600 },
    ])).toEqual({ buildId: 3, share: 0.6 })
    expect(pickTopBuild([{ hero_build_id: 1, matches: 10 }])).toBeNull()
    expect(pickTopBuild([])).toBeNull()
  })
})

describe('buildCommunityRecord', () => {
  function apiBuild(categories: { name: string; optional?: boolean; ids: number[] }[]): ApiBuild {
    return {
      hero_build: {
        hero_id: 13, hero_build_id: 211035, name: "  Parzelion's Haze Build ", last_updated_timestamp: 1_790_000_000,
        details: { mod_categories: categories.map(c => ({ name: c.name, optional: c.optional, mods: c.ids.map(ability_id => ({ ability_id })) })) },
      },
    }
  }

  it('nimmt nur Pflicht-Abschnitte, ohne unbekannte und doppelte Items', () => {
    const record = buildCommunityRecord(apiBuild([
      { name: '#Citadel_HeroBuilds_EarlyGame', ids: [1, 2, 3, 999] },
      { name: '', optional: true, ids: [4, 5] },
      { name: 'You have Ascended', ids: [6, 7, 2, 8] },
      { name: 'Leer', ids: [998] },
    ]), HAZE, 0.22, ITEMS, 5)!
    expect(record).toMatchObject({
      id: 'community:hero_haze', source: 'community', buildName: "Parzelion's Haze Build", buildId: 211035,
      share: 0.22, lastUpdated: 1_790_000_000_000, updatedAt: 5,
    })
    expect(record.sections.map(s => [s.title, s.items.map(i => i.itemId.replace('item:item_', ''))])).toEqual([
      ['Früh', ['1', '2', '3']],
      ['You have Ascended', ['6', '7', '8']],
    ])
  })

  it('kürzt Ausreißer auf 30 Items und verwirft zu kleine Builds', () => {
    const big = buildCommunityRecord(apiBuild([{ name: 'Alles', ids: ITEMS.map(i => i.apiId) }]), HAZE, 0.3, ITEMS, 0)!
    expect(buildSize(big)).toBe(MAX_COMMUNITY_ITEMS)
    expect(buildCommunityRecord(apiBuild([{ name: 'Klein', ids: [1, 2, 3] }]), HAZE, 0.3, ITEMS, 0)).toBeNull()
  })
})
