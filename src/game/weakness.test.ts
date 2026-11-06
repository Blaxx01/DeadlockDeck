import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { DeckDB } from '../data/db'
import { rateCard } from '../srs/srs'
import { hero, item } from '../test/counterFixtures'
import { checkDailyBonuses, missionContext, MISSIONS } from './missions'
import {
  describeCards, getWeaknesses, logMistake, pruneMistakes, rankWeaknesses, WEAK_MAX_CARDS, weakSince, type MistakeEntry,
} from './weakness'

const at = (d: number, h = 12) => new Date(2026, 10, d, h)

async function setup() {
  const database = new DeckDB(`w-${Math.random()}`)
  await database.items.bulkPut(Array.from({ length: 20 }, (_, i) => item(i + 1, `Item ${i + 1}`)))
  await database.heroes.bulkPut([hero(13, 'Haze'), hero(3, 'Vindicta')])
  return database
}

describe('rankWeaknesses', () => {
  const e = (cardId: string, source: MistakeEntry['source'], date: string, at: number): MistakeEntry => ({ id: at, cardId, source, date, at })

  it('meiste Fehler zuerst, bei Gleichstand der jüngste; Quellen gesammelt; alte zählen nicht', () => {
    const ranked = rankWeaknesses([
      e('item:a', 'quiz', '2026-11-05', 1), e('item:a', 'build', '2026-11-06', 5), e('item:b', 'learn', '2026-11-06', 9),
      e('item:c', 'quiz', '2026-11-04', 3), e('item:old', 'quiz', '2026-10-01', 2), e('item:b', 'learn', '2026-11-06', 10),
    ], '2026-10-24')
    expect(ranked.map(w => [w.cardId, w.count, w.sources])).toEqual([
      ['item:b', 2, ['learn']],
      ['item:a', 2, ['quiz', 'build']],
      ['item:c', 1, ['quiz']],
    ])
  })

  it('14 Tage: heute und die 13 Tage davor', () => {
    expect(weakSince(at(20))).toBe('2026-11-07')
  })
})

describe('Schwächen sammeln und beheben', () => {
  it('„nicht gewusst“ zählt als Fehler, „gewusst“ im Training behebt die Schwäche', async () => {
    const database = await setup()
    await rateCard('item:item_1', false, at(6), database)
    await rateCard('item:item_1', false, at(6, 13), database)
    await logMistake('item:item_1', 'quiz', at(6), database)
    await logMistake('hero:hero_haze', 'guess', at(6), database)
    let weak = await getWeaknesses(at(6), database)
    expect(weak.map(w => [w.cardId, w.count])).toEqual([['item:item_1', 3], ['hero:hero_haze', 1]])

    // normales Lernen mit „gewusst“ behebt nichts
    await rateCard('item:item_1', true, at(6, 14), database)
    expect((await getWeaknesses(at(6), database))[0].count).toBe(3)
    // im Training schon
    await rateCard('item:item_1', true, at(6, 15), database, { weak: true })
    await rateCard('hero:hero_haze', false, at(6, 15), database, { weak: true })
    weak = await getWeaknesses(at(6), database)
    expect(weak.map(w => [w.cardId, w.count])).toEqual([['hero:hero_haze', 2]])
    expect((await database.days.get('2026-11-06'))?.weak).toEqual(['item:item_1', 'hero:hero_haze'])
  })

  it('nur Karten, die es gibt, höchstens 15; alte Fehler verfallen', async () => {
    const database = await setup()
    for (let i = 1; i <= 18; i++) await logMistake(`item:item_${i}`, 'build', at(6), database)
    await logMistake('item:gone', 'quiz', at(6), database)
    const weak = await getWeaknesses(at(6), database)
    expect(weak).toHaveLength(WEAK_MAX_CARDS)
    expect(weak.some(w => w.cardId === 'item:gone')).toBe(false)

    expect(await getWeaknesses(at(20), database)).toEqual([])
    expect(await pruneMistakes(at(20), database)).toBe(19)
    expect(await database.mistakes.count()).toBe(0)
  })

  it('beschreibt Karten aller Decks für die Übersicht', async () => {
    const database = await setup()
    const cards = await describeCards(['item:item_2', 'hero:hero_haze', 'item:nope'], database)
    expect(cards.get('item:item_2')).toMatchObject({ label: 'Item 2', kind: 'Item' })
    expect(cards.get('hero:hero_haze')).toMatchObject({ label: 'Haze', kind: 'Hero' })
    expect(cards.has('item:nope')).toBe(false)
  })
})

describe('Mission „5 Schwächen-Karten üben“', () => {
  it('gibt es ab 5 Schwächen; zählt die im Training bewerteten Karten', async () => {
    const database = await setup()
    const mission = MISSIONS.find(m => m.id === 'learn-weak')!
    for (let i = 1; i <= 4; i++) await logMistake(`item:item_${i}`, 'quiz', at(6), database)
    expect(mission.available(await missionContext(at(6), database))).toBe(false)
    await logMistake('item:item_5', 'quiz', at(6), database)
    expect(mission.available(await missionContext(at(6), database))).toBe(true)

    await database.meta.put({ key: 'missions', value: { date: '2026-11-06', ids: ['learn-weak', 'quiz-7', 'guess-600'] } })
    for (let i = 1; i <= 5; i++) await rateCard(`item:item_${i}`, true, at(6, 14), database, { weak: true })
    expect(mission.progress(await missionContext(at(6), database))).toBe(5)
    const entries = await database.souls.where('reason').equals('mission').toArray()
    expect(entries.map(e => e.data?.id)).toEqual(['learn-weak'])
    expect(await checkDailyBonuses(at(6, 15), database)).toEqual([])
  })
})
