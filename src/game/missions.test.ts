import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { State } from 'ts-fsrs'
import { DeckDB, getMeta, getSettings, saveSettings } from '../data/db'
import { hero, item } from '../test/counterFixtures'
import { abilityCards, counterCard, fullHero, review } from '../test/masteryFixtures'
import { heroOffer } from './dayHero'
import { getLaneSummary, laneEvents, laneForDay, trackLane, type LaneChange } from './laneAttack'
import {
  ALL_MISSIONS_BONUS, checkDailyBonuses, chooseHero, dailyStatus, finishRound, heroSessionCards, learnedOnlyCounts, MISSION_SOULS,
  MISSIONS, pickMissions, todayMissionIds, todayMissions, type MissionContext,
} from './missions'
import { getSoulsTotal } from './souls'
import { logMistake } from './weakness'

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
    // erster Sieg: Serie 1 → +10 Serien-Bonus
    expect(gains.map(g => [g.reason, g.amount])).toEqual([['mission', MISSION_SOULS], ['missions', ALL_MISSIONS_BONUS], ['streak', 10]])
    expect(await checkDailyBonuses(now, database)).toEqual([])

    const status = await dailyStatus(now, database)
    expect(status.missions.every(m => m.done)).toBe(true)
    expect(status.bonus).toBe(true)
    // 50 + 90 + 70 aus den Runden, 3 × 100 Missionen, 150 Bonus, 10 Serien-Bonus
    expect(await getSoulsTotal(database)).toBe(50 + 90 + 70 + 3 * MISSION_SOULS + ALL_MISSIONS_BONUS + 10)
  })

  it('lost neue Missionen erst fest, wenn es drei gibt', async () => {
    const empty = new DeckDB(`m-${Math.random()}`)
    expect(await todayMissionIds(now, empty, true)).toEqual([])
    expect(await getMeta('missions', null, empty)).toBeNull()
    const database = await setup()
    const ids = await todayMissionIds(now, database, true)
    expect(ids).toHaveLength(3)
    expect(await getMeta('missions', null, database)).toMatchObject({ date: '2026-11-06', ids })
  })
})

describe('Lane-Angriff', () => {
  const now = new Date(2026, 10, 6, 12)

  it('der Gesamtfortschritt zerstört Guardian → Walker → Patron', async () => {
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

      // Quiz 5/7 = 71 % → Guardian 29 %; Hero erraten geschafft → 1,71 Missionen: Guardian fällt, Walker 29 %
      await finishRound('quiz', 50, { score: 500, correct: 5 }, now, database)
      expect(seen.at(-1)).toMatchObject({ damage: { kind: 'guardian', before: 100, after: 29 }, destroyed: [] })
      await finishRound('guess', 70, { score: 700 }, now, database)
      expect(seen.at(-1)).toMatchObject({ destroyed: ['guardian'], damage: { kind: 'walker', before: 100, after: 29 }, won: false })

      await finishRound('quiz', 90, { score: 900, correct: 8 }, now, database)
      expect(seen.at(-1)).toMatchObject({ destroyed: ['walker'], won: false })
      await database.days.put({ date: '2026-11-06', reviewed: 5, newIntroduced: 5, cards: ['item:a', 'item:b', 'item:c', 'item:d', 'item:e'] })
      await checkDailyBonuses(now, database)
      expect(seen.at(-1)).toMatchObject({ destroyed: ['patron'], won: true })

      const lane = (await dailyStatus(now, database)).lane!
      expect(lane).toMatchObject({ front: 3, won: true, streak: 1, trophy: 1, revenge: false })
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

async function heroSetup() {
  const database = await setup()
  const heroes = ['Haze', 'Wraith', 'Seven', 'Vindicta', 'Lash'].map((n, i) => fullHero(10 + i, n))
  await database.heroes.bulkPut(heroes)
  await database.abilities.bulkPut(heroes.flatMap(abilityCards))
  await database.counters.bulkPut(heroes.map(counterCard))
  return { database, heroes }
}

describe('Held des Tages', () => {
  const now = new Date(2026, 10, 6, 12)

  it('Vorschläge: zwei aus den am wenigsten bekannten, einer aus den übrigen – fest pro Tag', () => {
    const heroes = Array.from({ length: 20 }, (_, i) => ({ id: `hero:h${i}`, known: i }))
    const offer = heroOffer('2026-11-06', heroes)
    expect(offer).toHaveLength(3)
    expect(new Set(offer).size).toBe(3)
    expect(offer.slice(0, 2).every(id => Number(id.slice(6)) < 8)).toBe(true)
    expect(heroOffer('2026-11-06', heroes)).toEqual(offer)
    const days = ['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10'].map(d => heroOffer(d, heroes).join())
    expect(new Set([offer.join(), ...days]).size).toBeGreaterThan(1)
  })

  it('Hero-Mission statt Lern-Mission; die Wahl legt sie fest, wechseln nur ohne Fortschritt', async () => {
    const { database } = await heroSetup()
    const stored = await todayMissions(now, database, true)
    expect(stored.ids).toHaveLength(3)
    expect(stored.ids[0]).toBe('hero')
    expect(stored.heroOffer).toHaveLength(3)
    let status = await dailyStatus(now, database)
    expect(status.missions[0].def.title).toBe('Held des Tages wählen')
    expect(status.heroOffer?.map(h => [h.mode, h.cards])).toEqual([['learn', 6], ['learn', 6], ['learn', 6]])
    const [first, second] = stored.heroOffer!
    expect(await chooseHero('hero:hero_unbekannt', now, database)).toBe(false)
    expect(await chooseHero(first, now, database)).toBe(true)
    status = await dailyStatus(now, database)
    expect(status.hero).toMatchObject({ id: first, mode: 'learn', canChange: true })
    expect(status.hero!.cards).toHaveLength(6)
    expect(status.missions[0].def.title).toBe(`Karten von ${status.hero!.name} lernen`)
    expect(status.lane?.hero?.id).toBe(first)
    // noch kein Fortschritt: wechseln geht
    expect(await chooseHero(second, now, database)).toBe(true)
    const pick = (await dailyStatus(now, database)).hero!
    expect(pick.id).toBe(second)
    // eine seiner Karten heute gelernt → kein Wechsel mehr
    await database.days.put({ date: '2026-11-06', reviewed: 1, newIntroduced: 1, cards: [pick.cards[0]] })
    status = await dailyStatus(now, database)
    expect(status.missions[0]).toMatchObject({ progress: 1, done: false })
    expect(status.hero?.canChange).toBe(false)
    expect(status.heroOffer).toBeUndefined()
    expect(await chooseHero(first, now, database)).toBe(false)
    // Hero-Session: die übrigen Karten
    expect((await heroSessionCards(now, database))?.ids).toEqual(pick.cards.slice(1))
  })

  it('alle Karten gelernt: Build-Quiz mit ihm (höchstens 2 Fehler), ohne Build: Karten wiederholen', async () => {
    const { database, heroes } = await heroSetup()
    const stored = await todayMissions(now, database, true)
    const [withBuild, withoutBuild] = stored.heroOffer!.map(id => heroes.find(h => h.id === id)!)
    for (const h of [withBuild, withoutBuild]) {
      await database.reviews.bulkPut([h.id, ...h.abilities.map(a => a.id), `counter:${h.className}`].map(id => review(id, 5)))
    }
    await database.builds.put({ id: `typical:${withBuild.className}`, source: 'typical', heroId: withBuild.heroId, heroName: withBuild.name, sections: [], updatedAt: 0 })
    expect(await chooseHero(withoutBuild.id, now, database)).toBe(true)
    let status = await dailyStatus(now, database)
    expect(status.hero).toMatchObject({ mode: 'review' })
    expect(status.missions[0].def).toMatchObject({ title: `Karten von ${withoutBuild.name} wiederholen`, target: 6 })
    expect(await chooseHero(withBuild.id, now, database)).toBe(true)
    status = await dailyStatus(now, database)
    expect(status.hero).toMatchObject({ mode: 'build', heroId: withBuild.heroId })
    expect(status.missions[0].def.title).toBe(`Build-Quiz mit ${withBuild.name}: höchstens 2 Fehler`)
    await finishRound('build', 40, { errors: 3, items: 12, heroId: withBuild.heroId, source: 'typical' }, now, database)
    expect((await dailyStatus(now, database)).missions[0].done).toBe(false)
    await finishRound('build', 60, { errors: 2, items: 12, heroId: withBuild.heroId, source: 'community' }, now, database)
    expect((await dailyStatus(now, database)).missions[0].done).toBe(true)
    expect(await heroSessionCards(now, database)).toBeNull()
    trackLane(null)
  })
})

describe('Mid Boss', () => {
  const now = new Date(2026, 10, 6, 12)

  it('Schwächen-Training besiegt ihn – Eintrag ohne Souls, Rejuvenator auf Vorrat', async () => {
    const database = await setup()
    for (let i = 1; i <= 6; i++) await logMistake(`item:item_${i}`, 'quiz', new Date(2026, 10, 5, 12), database)
    const stored = await todayMissions(now, database, true)
    expect(stored.midBoss).toEqual({ kind: 'weak', target: 6 })
    const seen: LaneChange[] = []
    const listener = (e: Event) => seen.push((e as CustomEvent<LaneChange>).detail)
    laneEvents.addEventListener('lane', listener)
    try {
      trackLane(null)
      await checkDailyBonuses(now, database)
      let status = await dailyStatus(now, database)
      expect(status.midBoss).toMatchObject({ progress: 0, done: false })
      expect(status.midBoss?.def.title).toBe('6 Schwächen-Karten üben')
      const before = await getSoulsTotal(database)
      await database.days.put({ date: '2026-11-06', reviewed: 6, newIntroduced: 0, weak: ['a', 'b', 'c', 'd', 'e', 'f'] })
      await checkDailyBonuses(now, database)
      status = await dailyStatus(now, database)
      expect(status.midBoss?.done).toBe(true)
      expect(status.lane).toMatchObject({ rejuvenator: true, midBoss: { done: true } })
      expect(seen.at(-1)).toMatchObject({ midBoss: true })
      expect((await database.souls.toArray()).filter(e => e.reason === 'midboss')).toHaveLength(1)
      expect(await getSoulsTotal(database)).toBe(before)
      await checkDailyBonuses(now, database)
      expect((await database.souls.toArray()).filter(e => e.reason === 'midboss')).toHaveLength(1)
    } finally {
      laneEvents.removeEventListener('lane', listener)
      trackLane(null)
    }
  })

  it('zu wenige Schwächen: eine schwere Spiel-Aufgabe', async () => {
    const database = await setup()
    const stored = await todayMissions(now, database, true)
    expect(stored.midBoss?.kind).toBe('play')
    expect(['quiz-9', 'sprint-25', 'survival-20']).toContain(stored.midBoss?.kind === 'play' ? stored.midBoss.id : '')
  })
})

describe('Sieg', () => {
  const now = new Date(2026, 10, 6, 12)

  it('nach einer Niederlage: Revanche gegen denselben Patron, doppelter Serien-Bonus, erste Trophäe', async () => {
    const database = await setup()
    await database.meta.put({ key: 'laneStart', value: '2026-11-01' })
    // gestern gelernt, aber nicht gewonnen → Niederlage
    await database.souls.add({ at: new Date(2026, 10, 5, 12).getTime(), date: '2026-11-05', amount: 10, reason: 'card' })
    await database.meta.put({ key: 'missions', value: { date: '2026-11-06', ids: ['quiz-7', 'guess-600', 'learn-new'] } })
    await finishRound('quiz', 90, { score: 900, correct: 8 }, now, database)
    await finishRound('guess', 70, { score: 700 }, now, database)
    await database.days.put({ date: '2026-11-06', reviewed: 5, newIntroduced: 5, cards: ['item:a', 'item:b', 'item:c', 'item:d', 'item:e'] })
    const gains = await checkDailyBonuses(now, database)
    expect(gains.map(g => [g.reason, g.amount])).toEqual([['mission', MISSION_SOULS], ['missions', ALL_MISSIONS_BONUS], ['streak', 20]])
    expect(gains.at(-1)?.label).toBe('⚔ Revanche · Serie 1')
    const patron = laneForDay('2026-11-05').patron
    const bonus = (await database.souls.toArray()).find(e => e.reason === 'missions')!
    expect(bonus.data).toMatchObject({ patron, revenge: true, lane: laneForDay('2026-11-06').lane })
    expect((await dailyStatus(now, database)).lane).toMatchObject({ won: true, revenge: true, patron, streak: 1, trophy: 1 })
    expect(await getLaneSummary(now, database)).toMatchObject({ wins: 1, losses: 1, streak: 1 })
    trackLane(null)
  })
})
