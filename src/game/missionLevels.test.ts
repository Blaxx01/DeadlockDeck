import { describe, expect, it } from 'vitest'
import { HERO_BUILD_ERRORS, levelSouls, missionLevel, nextUnlock, swapPrice, unlocksBetween } from './missionLevels'
import { bossMissionsForLevel, MISSIONS, missionsForLevel, type MissionContext } from './missions'
import { RANK_STEPS, stepCost } from './ranks'

const ctxAll: MissionContext = {
  entries: [], deckSizes: { items: 100, abilities: 100, heroes: 40, counters: 40 }, heroCount: 40, buildCount: 40, weakCount: 0, mapReady: true,
}
const playIds = (level: 0 | 1 | 2 | 3) => missionsForLevel(level).filter(m => m.kind === 'play').map(m => m.id)

describe('Missions-Stufen', () => {
  it('aus dem Rang: Start, ab Kultist 1, ab Akolyth 1, ab Wächter 1', () => {
    expect([levelSouls(1), levelSouls(2), levelSouls(3)]).toEqual([5_500, 12_250, 20_350])
    expect(missionLevel(0)).toBe(0)
    expect(missionLevel(5_499)).toBe(0)
    expect(missionLevel(5_500)).toBe(1)
    expect(missionLevel(12_249)).toBe(1)
    expect(missionLevel(12_250)).toBe(2)
    expect(missionLevel(20_350)).toBe(3)
    expect(missionLevel(200_000)).toBe(3)
  })

  it('am Anfang nur Quiz, Map-Quiz und Überleben mit leichten Zielen; Build-Quiz erst ab Akolyth 1', () => {
    expect(playIds(0)).toEqual(['quiz-5', 'map-5', 'survival-5'])
    expect(playIds(1)).toEqual(['quiz-6', 'guess-400', 'sprint-10', 'map-6', 'survival-7'])
    expect(playIds(2)).toEqual(['quiz-7', 'quiz-800', 'guess-500', 'build-3', 'sprint-12', 'map-7', 'survival-10'])
    // höchste Stufe = die Ziele von vor den Stufen
    expect(playIds(3)).toEqual(['quiz-7', 'quiz-1000', 'guess-600', 'build-clean', 'sprint-15', 'map-7', 'survival-10'])
    expect(MISSIONS.map(m => m.id)).toEqual(missionsForLevel(3).map(m => m.id))
    // Lern-Missionen gibt es auf jeder Stufe
    expect(missionsForLevel(0).filter(m => m.kind === 'learn')).toHaveLength(6)
    const titles = missionsForLevel(2).map(m => m.title)
    expect(titles).toContain('Build-Quiz mit höchstens 3 Fehlern')
    expect(titles).toContain('Quiz-Runde mit mindestens 800 Punkten')
    expect(missionsForLevel(3).map(m => m.title)).toContain('Quiz-Runde mit mindestens 1.000 Punkten')
  })

  it('Build-Quiz mit höchstens 3 Fehlern: 3 Fehler reichen, 4 nicht', () => {
    const build = missionsForLevel(2).find(m => m.id === 'build-3')!
    const entry = (errors: number) => ({ id: 1, at: 0, date: '2026-11-06', amount: 10, reason: 'build' as const, data: { errors } })
    expect(build.progress({ ...ctxAll, entries: [entry(4)] })).toBe(0)
    expect(build.progress({ ...ctxAll, entries: [entry(3)] })).toBe(1)
  })

  it('Mid Boss: die Ziele der nächsten Stufe, ab Wächter 1 die schweren', () => {
    expect(bossMissionsForLevel(0).map(m => m.id)).toEqual(['quiz-6', 'sprint-10', 'map-6', 'survival-7'])
    expect(bossMissionsForLevel(2).map(m => m.id)).toEqual(['quiz-7', 'sprint-15', 'map-7', 'survival-10'])
    expect(bossMissionsForLevel(3).map(m => m.id)).toEqual(['quiz-9', 'sprint-25', 'map-9', 'survival-20'])
  })

  it('Held des Tages: Build-Quiz ab Akolyth 1 mit 4, ab Wächter 1 mit 2 Fehlern', () => {
    expect(HERO_BUILD_ERRORS).toEqual([null, null, 4, 2])
  })

  it('nächste Freischaltung und was ein Aufstieg freischaltet', () => {
    expect(nextUnlock(1_000)).toEqual({ level: 1, tier: 2, souls: 5_500, missing: 4_500, text: 'Sprint und Hero erraten' })
    expect(nextUnlock(12_000)).toMatchObject({ level: 2, tier: 3, missing: 250, text: 'Build-Quiz und Quiz-Punkte' })
    expect(nextUnlock(20_350)).toBeUndefined()
    expect(unlocksBetween(5_000, 5_600)).toEqual(['Sprint und Hero erraten'])
    expect(unlocksBetween(5_000, 12_300)).toEqual(['Sprint und Hero erraten', 'Build-Quiz und Quiz-Punkte'])
    expect(unlocksBetween(6_000, 7_000)).toEqual([])
  })
})

describe('Preis fürs Lane-Tauschen', () => {
  it('ein Viertel der nächsten Rangstufe, auf 10 gerundet, 200–800 ◆', () => {
    // noch kein Rang (bis Novize 1 nur 100 Souls): mindestens 200
    expect(swapPrice(0)).toBe(200)
    // Novize 1 → Novize 2 kostet 800
    expect(swapPrice(RANK_STEPS[0].souls)).toBe(200)
    // Akolyth 1 → Akolyth 2: stepCost(13) = 1.250 → 312,5 → 310
    expect(stepCost(13)).toBe(1_250)
    expect(swapPrice(12_250)).toBe(310)
    // ganz oben: höchstens 800
    expect(swapPrice(RANK_STEPS.at(-1)!.souls + 10_000)).toBe(800)
  })
})
