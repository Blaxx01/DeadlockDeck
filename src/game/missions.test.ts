import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { State } from 'ts-fsrs'
import { DeckDB, getMeta, getSettings, saveSettings } from '../data/db'
import { hero, item } from '../test/counterFixtures'
import { review } from '../test/masteryFixtures'
import {
  ALL_MISSIONS_BONUS, checkDailyBonuses, dailyStatus, finishRound, learnedOnlyCounts, MISSION_SOULS, MISSIONS, pickMissions,
  todayMissionIds, type MissionContext,
} from './missions'
import { getLaneSummary, laneEvents, trackLane, type LaneChange } from './laneAttack'
import { getSoulsTotal } from './souls'

const ctxAll: MissionContext = { entries: [], deckSizes: { items: 100, abilities: 100, heroes: 40, counters: 40 }, heroCount: 40, buildCount: 40, weakCount: 10 }
const available = (ctx: MissionContext) => MISSIONS.filter(m => m.available(ctx))
const byId = new Map(MISSIONS.map(m => [m.id, m]))

describe('pickMissions', () => {
  it('fest pro Tag: eine Lern- und zwei Spiel-Missionen aus verschiedenen Gruppen', () => {
    for (const date of ['2026-11-06', '2026-11-07', '2026-12-24', '2027-01-01']) {
      const ids = pickMissions(date, available(ctxAll))
      expect(pickMissions(date, available(ctxAll))).toEqual(ids)
      const defs = ids.map(id => byId.get(id)!)
      expect(defs.map(d => d.kind)).toEqual(['learn', 'play', 'play'])
      expect(new Set(defs.map(d => d.group)).size).toBe(3)
    }
  })

  it('ohne Hero- und Build-Daten wird mit anderen Missionen aufgefüllt', () => {
    const ids = pickMissions('2026-11-06', available({ ...ctxAll, heroCount: 0, buildCount: 0, deckSizes: { items: 100 } }))
    expect(ids).toHaveLength(3)
    expect(ids.every(id => !['guess-600', 'build-clean'].includes(id))).toBe(true)
  })
})

describe('Einstellung „Nur Gelerntes“', () => {
  const PLAY = ['quiz-7', 'quiz-1000', 'guess-600', 'sprint-15', 'survival-10']

  it('Spiel-Missionen nur, wenn eine volle Runde mit gelernten Karten möglich ist', () => {
    const few = { ...ctxAll, learnedOnly: { items: 9, abilities: 3, heroes: 2 } }
    expect(available(few).map(m => m.id).filter(id => PLAY.includes(id))).toEqual([])
    const enough = { ...ctxAll, learnedOnly: { items: 10, abilities: 0, heroes: 10 } }
    expect(available(enough).map(m => m.id)).toEqual(available(ctxAll).map(m => m.id))
    // der Sprint geht auch mit einer anderen Sorte
    expect(available({ ...ctxAll, learnedOnly: { items: 0, abilities: 12, heroes: 0 } }).map(m => m.id).filter(id => PLAY.includes(id)))
      .toEqual(['sprint-15'])
  })

  it('zählt gelernte Karten je Sorte nur bei „Nur Gelerntes“ – ohne Rückrichtung und ungelernte', async () => {
    const database = await setup()
    await database.reviews.bulkPut([
      review('item:item_1', 5), review('item:item_1~r', 5), review('hero:hero_hero1', 3), review('item:item_2', 0, State.New),
    ])
    expect(await learnedOnlyCounts(database)).toBeUndefined()
    await saveSettings({ ...(await getSettings(database)), quizScope: 'learned-only' }, database)
    expect(await learnedOnlyCounts(database)).toEqual({ items: 1, abilities: 0, heroes: 1 })
  })

  it('beim Auslosen berücksichtigt; Tagesbonus-Prüfung läuft auch so (Lernstände außerhalb der Transaktion)', async () => {
    const database = await setup()
    await saveSettings({ ...(await getSettings(database)), quizScope: 'learned-only' }, database)
    const now = new Date(2026, 10, 6, 12)
    const ids = await todayMissionIds(now, database)
    expect(ids.filter(id => PLAY.includes(id))).toEqual([])
    await expect(checkDailyBonuses(now, database)).resolves.toEqual([])
    expect(await getMeta('missions', null, database)).toMatchObject({ date: '2026-11-06' })
  })
})

async function setup() {
  const database = new DeckDB(`m-${Math.random()}`)
  await database.items.bulkPut(Array.from({ length: 20 }, (_, i) => item(i + 1, `Item ${i + 1}`)))
  await database.heroes.bulkPut(Array.from({ length: 6 }, (_, i) => hero(i + 1, `Hero${i + 1}`)))
  return database
}

describe('Tagesmissionen', () => {
  const now = new Date(2026, 10, 6, 12)

  it('werden einmal gutgeschrieben, alle drei bringen den Bonus', async () => {
    const database = await setup()
    // Missionen dieses Tages fest vorgeben: Quiz, Hero erraten, neue Karten
    await database.meta.put({ key: 'missions', value: { date: '2026-11-06', ids: ['quiz-7', 'guess-600', 'learn-new'] } })
    expect(await todayMissionIds(now, database)).toEqual(['quiz-7', 'guess-600', 'learn-new'])

    await finishRound('quiz', 50, { score: 500, correct: 6 }, now, database)
    expect((await dailyStatus(now, database)).missions.map(m => [m.def.id, m.progress, m.done])).toEqual([
      ['quiz-7', 6, false], ['guess-600', 0, false], ['learn-new', 0, false],
    ])
    await finishRound('quiz', 90, { score: 900, correct: 8 }, now, database)
    await finishRound('guess', 70, { score: 700 }, now, database)
    await database.days.put({ date: '2026-11-06', reviewed: 5, newIntroduced: 5, cards: ['item:a', 'item:b', 'item:c', 'item:d', 'item:e'] })
    const gains = await checkDailyBonuses(now, database)
    expect(gains.map(g => [g.reason, g.amount])).toEqual([['mission', MISSION_SOULS], ['missions', ALL_MISSIONS_BONUS]])
    expect(await checkDailyBonuses(now, database)).toEqual([])

    const status = await dailyStatus(now, database)
    expect(status.missions.every(m => m.done)).toBe(true)
    expect(status.bonus).toBe(true)
    // 50 + 90 + 70 aus den Runden, 3 × 100 Missionen, 150 Bonus
    expect(await getSoulsTotal(database)).toBe(50 + 90 + 70 + 3 * MISSION_SOULS + ALL_MISSIONS_BONUS)
  })

  it('lost neue Missionen erst fest, wenn es drei gibt', async () => {
    const empty = new DeckDB(`m-${Math.random()}`)
    expect(await todayMissionIds(now, empty, true)).toEqual([])
    expect(await getMeta('missions', null, empty)).toBeNull()
    const database = await setup()
    const ids = await todayMissionIds(now, database, true)
    expect(ids).toHaveLength(3)
    expect(await getMeta('missions', null, database)).toEqual({ date: '2026-11-06', ids })
  })
})

describe('Lane-Angriff', () => {
  const now = new Date(2026, 10, 6, 12)

  it('Missionen zerstören Guardian → Walker → Patron in der Reihenfolge, in der sie geschafft werden', async () => {
    const database = await setup()
    await database.meta.put({ key: 'missions', value: { date: '2026-11-06', ids: ['quiz-7', 'guess-600', 'learn-new'] } })
    const seen: LaneChange[] = []
    const listener = (e: Event) => seen.push((e as CustomEvent<LaneChange>).detail)
    laneEvents.addEventListener('lane', listener)
    try {
      trackLane(null)
      await checkDailyBonuses(now, database)
      // ab heute zählen Siege und Niederlagen
      expect(await getMeta('laneStart', null, database)).toBe('2026-11-06')
      expect(seen).toEqual([])

      // Hero erraten zuerst geschafft → Guardian; die Quiz-Runde (5/7) hat ihn schon angeschlagen
      await finishRound('quiz', 50, { score: 500, correct: 5 }, now, database)
      expect(seen.at(-1)).toMatchObject({ damage: { kind: 'guardian', before: 100, after: 29 }, destroyed: [] })
      await finishRound('guess', 70, { score: 700 }, now, database)
      expect(seen.at(-1)).toMatchObject({ destroyed: ['guardian'], damage: { kind: 'walker', before: 100, after: 29 }, won: false })
      let lane = (await dailyStatus(now, database)).lane!
      expect(lane.targets.map(t => t.by)).toEqual(['Hero erraten mit mindestens 600 Punkten', undefined, undefined])

      await finishRound('quiz', 90, { score: 900, correct: 8 }, now, database)
      expect(seen.at(-1)).toMatchObject({ destroyed: ['walker'], won: false })
      await database.days.put({ date: '2026-11-06', reviewed: 5, newIntroduced: 5, cards: ['item:a', 'item:b', 'item:c', 'item:d', 'item:e'] })
      await checkDailyBonuses(now, database)
      expect(seen.at(-1)).toMatchObject({ destroyed: ['patron'], won: true })

      lane = (await dailyStatus(now, database)).lane!
      expect(lane).toMatchObject({ front: 3, won: true })
      expect(lane.targets.map(t => t.by)).toEqual([
        'Hero erraten mit mindestens 600 Punkten', 'Quiz mit mindestens 7 richtigen Antworten', '5 neue Karten lernen',
      ])
      expect(await getLaneSummary(now, database)).toMatchObject({ wins: 1, losses: 0, streak: 1 })
      // am nächsten Tag: Sieg bleibt, neue Lane
      expect(await getLaneSummary(new Date(2026, 10, 7, 12), database)).toMatchObject({ wins: 1, losses: 0 })
    } finally {
      laneEvents.removeEventListener('lane', listener)
      trackLane(null)
    }
  })

  it('nicht geschafft: Niederlage, sobald der Tag vorbei ist', async () => {
    const database = await setup()
    await database.meta.put({ key: 'missions', value: { date: '2026-11-06', ids: ['quiz-7', 'guess-600', 'learn-new'] } })
    await finishRound('quiz', 90, { score: 900, correct: 8 }, now, database)
    expect(await getLaneSummary(now, database)).toMatchObject({ wins: 0, losses: 0 })
    expect(await getLaneSummary(new Date(2026, 10, 7, 9), database)).toMatchObject({ wins: 0, losses: 1, streak: 0 })
    trackLane(null)
  })
})
