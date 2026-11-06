import 'fake-indexeddb/auto'
import { State } from 'ts-fsrs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rateCard } from '../srs/srs'
import { hero, item, stat } from '../test/counterFixtures'
import { countersDue, COUNTER_REFRESH_DAYS, syncCounters } from './counterSync'
import type { ApiItemStat } from './counters'
import { DeckDB, getMeta, setMeta } from './db'

const ITEMS = [item(1, 'Alpha'), item(2, 'Beta'), item(3, 'Gamma'), item(4, 'Delta')]
const HEROES = [hero(10, 'Haze'), hero(11, 'Vindicta')]
const BASE = [stat(1, 10_000), stat(2, 10_000), stat(3, 10_000), stat(4, 10_000)]

/** Haze: Alpha 1,6× vorn; Vindicta: Beta 2,0× vorn */
const FIRST = [
  stat(1, 8000, 10), stat(2, 4000, 10), stat(3, 4000, 10), stat(4, 4000, 10),
  stat(2, 9000, 11), stat(1, 3000, 11), stat(3, 3000, 11), stat(4, 3000, 11),
]

async function setup() {
  const database = new DeckDB(`c-${Math.random()}`)
  await database.items.bulkPut(ITEMS)
  await database.heroes.bulkPut(HEROES)
  return database
}

function mockStats(byEnemy: ApiItemStat[], base: ApiItemStat[] = BASE) {
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => (url.includes('bucket=enemy_hero') ? byEnemy : base),
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('syncCounters', () => {
  it('lädt ab Orakel, speichert die Karten und lädt erst nach einer Woche wieder', async () => {
    const database = await setup()
    const fetchMock = mockStats(FIRST)
    expect(await syncCounters(database)).toEqual({ updated: true, heroes: 2, changed: 0 })
    const urls = fetchMock.mock.calls.map(c => c[0])
    expect(urls.every(u => u.includes('/v1/analytics/item-stats') && u.includes('min_average_badge=81'))).toBe(true)
    expect(urls.some(u => u.includes('bucket=enemy_hero'))).toBe(true)

    const cards = await database.counters.toArray()
    expect(cards.map(c => [c.id, c.order, c.top[0].itemId]).sort()).toEqual([
      ['counter:hero_haze', 1, 'item:alpha'],
      ['counter:hero_vindicta', 0, 'item:beta'],
    ])
    expect(await getMeta('countersError', 'x', database)).toBeNull()
    // Käufe je Item für „Items nach Beliebtheit“ (aus derselben Abfrage)
    expect(await getMeta('itemPurchases', {}, database)).toEqual({ 'item:alpha': 10_000, 'item:beta': 10_000, 'item:gamma': 10_000, 'item:delta': 10_000 })

    // Innerhalb einer Woche: keine neue Abfrage
    fetchMock.mockClear()
    expect((await syncCounters(database)).updated).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    await setMeta('countersSync', Date.now() - (COUNTER_REFRESH_DAYS + 1) * 86_400_000, database)
    expect(await countersDue(database)).toBe(true)
  })

  it('macht gelernte Karten mit neuem klarem Top-Counter fällig und merkt sich vorher → nachher', async () => {
    const database = await setup()
    mockStats(FIRST)
    await syncCounters(database)
    let t = new Date()
    for (let i = 0; i < 4; i++) t = (await rateCard('counter:hero_haze', true, t, database)).due
    for (let i = 0; i < 4; i++) t = (await rateCard('counter:hero_vindicta', true, t, database)).due
    expect((await database.reviews.get('counter:hero_haze'))!.due.getTime()).toBeGreaterThan(Date.now())

    // Haze: jetzt Gamma vorn (klar); Vindicta: Beta bleibt vorn
    mockStats([
      stat(3, 8000, 10), stat(1, 4000, 10), stat(2, 4000, 10), stat(4, 4000, 10),
      stat(2, 8000, 11), stat(1, 4000, 11), stat(3, 3000, 11), stat(4, 3000, 11),
    ])
    expect(await syncCounters(database, { force: true })).toEqual({ updated: true, heroes: 2, changed: 1 })
    const patch = await database.patches.get('counter:hero_haze')
    expect(patch?.changes).toEqual([{ label: 'Wichtigstes Item', before: 'Alpha 1,6×', after: 'Gamma 1,6×' }])
    const haze = (await database.reviews.get('counter:hero_haze'))!
    expect(haze.state).not.toBe(State.New)
    expect(haze.due.getTime()).toBeLessThanOrEqual(Date.now())
    // Unverändertes Top-Item: nicht fällig, kein Eintrag
    expect(await database.patches.get('counter:hero_vindicta')).toBeUndefined()
    expect((await database.reviews.get('counter:hero_vindicta'))!.due.getTime()).toBeGreaterThan(Date.now())
  })

  it('behält bei Fehlern den alten Stand und merkt sich den Fehler', async () => {
    const database = await setup()
    mockStats(FIRST)
    await syncCounters(database)
    const syncedAt = await getMeta<number>('countersSync', 0, database)

    vi.stubGlobal('fetch', async () => ({ ok: false, status: 504, json: async () => ({}) }))
    await expect(syncCounters(database, { force: true })).rejects.toThrow('504')
    expect(await database.counters.count()).toBe(2)
    expect(await getMeta('countersSync', 0, database)).toBe(syncedAt)
    expect(await getMeta<string | null>('countersError', null, database)).toContain('504')

    // Unvollständige Antwort (nur ein Hero von zwei mit Daten) → alter Stand bleibt
    mockStats([stat(1, 8000, 10), stat(2, 4000, 10)])
    await expect(syncCounters(database, { force: true })).rejects.toThrow('zu wenige Counter-Daten')
    expect(await database.counters.count()).toBe(2)
  })

  it('wartet auf Item-Daten mit API-IDs (vor dem ersten normalen Sync)', async () => {
    const database = new DeckDB(`c-${Math.random()}`)
    const fetchMock = mockStats(FIRST)
    expect((await syncCounters(database)).updated).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
