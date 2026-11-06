import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hero, item } from '../test/counterFixtures'
import { buildsDue, BUILDS_REFRESH_DAYS, syncBuilds } from './buildSync'
import type { ApiBuild } from './builds'
import type { ApiItemStat } from './counters'
import { buildBestKey, DeckDB, getBuildBests, getMeta, isBetterBuildResult, setMeta, submitBuildResult } from './db'

const ITEMS = Array.from({ length: 24 }, (_, i) => item(i + 1, `Item ${i + 1}`))
const HEROES = [hero(13, 'Haze'), hero(3, 'Vindicta')]

function rows(heroId: number): ApiItemStat[] {
  return Array.from({ length: 18 }, (_, i) => ({ item_id: i + 1, bucket: heroId, matches: 5000 - i * 10, wins: 0, losses: 0, avg_buy_time_s: 100 * (i + 1) }))
}

function communityBuild(heroId: number, buildId: number, ids: number[]): ApiBuild {
  return { hero_build: { hero_id: heroId, hero_build_id: buildId, name: `Build ${buildId}`, details: { mod_categories: [{ name: 'Core', mods: ids.map(ability_id => ({ ability_id })) }] } } }
}

/** API-Attrappe; `failHero` lässt die Community-Abfrage eines Heroes scheitern */
function mockApi({ failHero, buildItems = [1, 2, 3, 4, 5, 6, 7] }: { failHero?: number; buildItems?: number[] } = {}) {
  const fetchMock = vi.fn(async (url: string) => {
    let body: unknown
    if (url.includes('/item-stats?bucket=hero')) body = [...rows(13), ...rows(3)]
    else if (url.includes('/hero-stats')) body = [{ hero_id: 13, matches: 10_000 }, { hero_id: 3, matches: 8000 }]
    else if (url.includes('/hero-build-stats/')) {
      const heroId = Number(/hero-build-stats\/(\d+)/.exec(url)![1])
      if (heroId === failHero) return { ok: false, status: 503, json: async () => ({}) }
      body = [{ hero_build_id: heroId * 100, matches: 900 }, { hero_build_id: heroId * 100 + 1, matches: 100 }]
    } else if (url.includes('/v1/builds?build_id=')) {
      const buildId = Number(/build_id=(\d+)/.exec(url)![1])
      body = [communityBuild(Math.floor(buildId / 100), buildId, buildItems)]
    }
    return { ok: true, status: 200, json: async () => body }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function setup() {
  const database = new DeckDB(`b-${Math.random()}`)
  await database.items.bulkPut(ITEMS)
  await database.heroes.bulkPut(HEROES)
  return database
}

afterEach(() => vi.unstubAllGlobals())

describe('syncBuilds', () => {
  it('lädt typische und Community-Builds ab Orakel und erst nach einer Woche wieder', async () => {
    const database = await setup()
    const fetchMock = mockApi()
    expect(await syncBuilds(database)).toEqual({ updated: true, typical: 2, community: 2 })
    const urls = fetchMock.mock.calls.map(c => c[0])
    expect(urls.filter(u => u.includes('/analytics/')).every(u => u.includes('min_average_badge=81'))).toBe(true)

    const haze = await database.builds.get('community:hero_haze')
    expect(haze).toMatchObject({ buildName: 'Build 1300', share: 0.9 })
    expect((await database.builds.get('typical:hero_vindicta'))!.sections.flatMap(s => s.items)).toHaveLength(16)
    expect(await getMeta('buildsError', 'x', database)).toBeNull()

    fetchMock.mockClear()
    expect((await syncBuilds(database)).updated).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    await setMeta('buildsSync', Date.now() - (BUILDS_REFRESH_DAYS + 1) * 86_400_000, database)
    expect(await buildsDue(database)).toBe(true)
  })

  it('behält den alten Community-Build eines Heroes, dessen Abfrage scheitert', async () => {
    const database = await setup()
    mockApi()
    await syncBuilds(database)
    mockApi({ failHero: 3, buildItems: [8, 9, 10, 11, 12, 13] })
    expect(await syncBuilds(database, { force: true })).toEqual({ updated: true, typical: 2, community: 1 })
    const ids = (b: { sections: { items: { itemId: string }[] }[] } | undefined) => b!.sections.flatMap(s => s.items.map(i => i.itemId))
    expect(ids(await database.builds.get('community:hero_haze'))[0]).toBe('item:item_8') // neu
    expect(ids(await database.builds.get('community:hero_vindicta'))[0]).toBe('item:item_1') // alter Stand
  })

  it('merkt sich Fehler und behält den alten Stand', async () => {
    const database = await setup()
    mockApi()
    await syncBuilds(database)
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 504, json: async () => ({}) }))
    await expect(syncBuilds(database, { force: true })).rejects.toThrow('504')
    expect(await database.builds.count()).toBe(4)
    expect(await getMeta<string | null>('buildsError', null, database)).toContain('504')
  })
})

describe('Bestwerte', () => {
  it('besser = weniger Fehler, bei Gleichstand schneller', () => {
    expect(isBetterBuildResult({ errors: 2, ms: 90_000 }, undefined)).toBe(true)
    expect(isBetterBuildResult({ errors: 1, ms: 99_000 }, { errors: 2, ms: 50_000 })).toBe(true)
    expect(isBetterBuildResult({ errors: 2, ms: 49_000 }, { errors: 2, ms: 50_000 })).toBe(true)
    expect(isBetterBuildResult({ errors: 2, ms: 50_000 }, { errors: 2, ms: 50_000 })).toBe(false)
    expect(isBetterBuildResult({ errors: 3, ms: 10_000 }, { errors: 2, ms: 50_000 })).toBe(false)
  })

  it('speichert je Hero und Build-Art nur Verbesserungen', async () => {
    const database = new DeckDB(`best-${Math.random()}`)
    const key = buildBestKey('typical', 13)
    expect(await submitBuildResult(key, { errors: 2, ms: 80_000 }, database)).toBe(true)
    expect(await submitBuildResult(key, { errors: 3, ms: 40_000 }, database)).toBe(false)
    expect(await submitBuildResult(buildBestKey('community', 13), { errors: 5, ms: 1 }, database)).toBe(true)
    const bests = await getBuildBests(database)
    expect(bests[key]).toMatchObject({ errors: 2, ms: 80_000 })
    expect(Object.keys(bests).sort()).toEqual(['community:13', 'typical:13'])
  })
})
