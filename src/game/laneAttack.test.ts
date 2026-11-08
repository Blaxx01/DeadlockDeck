import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { addDays } from '../data/dates'
import { DeckDB, getMeta } from '../data/db'
import type { MapData, MapPoint } from '../map/mapData'
import {
  ATTACK_LANES, getLaneSummary, hpPercent, isShown, laneAnimationStart, laneChange, laneContextOf, laneEvents, laneForDay,
  laneHistory, laneState, laneTargetPoints, PATRONS, shownOf, streakBonus, trackLane, TROPHY_WINS,
  type LaneChange, type LaneMission, type LaneState,
} from './laneAttack'
import type { SoulsEntry } from './souls'

const DATE = '2026-11-06'

function mission(id: string, progress: number, target: number, done = false): LaneMission {
  return { def: { id, title: `Mission ${id}`, target }, progress, done }
}

const hps = (s: LaneState | null) => s?.targets.map(t => hpPercent(t.hp))

afterEach(() => { trackLane(null) })

describe('Lane und Gegner des Tages', () => {
  it('fest pro Datum, über die Tage gemischt', () => {
    expect(laneForDay(DATE)).toEqual(laneForDay(DATE))
    const lanes = new Map<string, number>()
    const patrons = new Map<string, number>()
    let changes = 0
    for (let i = 0; i < 730; i++) {
      const day = laneForDay(addDays('2026-01-01', i))
      lanes.set(day.lane, (lanes.get(day.lane) ?? 0) + 1)
      patrons.set(day.patron, (patrons.get(day.patron) ?? 0) + 1)
      if (i > 0 && day.lane !== laneForDay(addDays('2026-01-01', i - 1)).lane) changes++
    }
    expect([...lanes.keys()].sort()).toEqual([...ATTACK_LANES].sort())
    for (const n of lanes.values()) expect(n / 730).toBeGreaterThan(0.25)
    expect([...patrons.keys()].sort()).toEqual([...PATRONS].sort())
    for (const n of patrons.values()) expect(n / 730).toBeGreaterThan(0.4)
    // nicht in Blöcken: die Lane wechselt oft
    expect(changes / 729).toBeGreaterThan(0.55)
  })
})

describe('Stand des Lane-Angriffs', () => {
  it('nur mit drei Missionen', () => {
    expect(laneState(DATE, [mission('a', 0, 5), mission('b', 0, 7)])).toBeNull()
  })

  it('Schaden = Gesamtfortschritt: jede Mission zählt, je volle Mission fällt ein Ziel', () => {
    const fresh = laneState(DATE, [mission('a', 0, 5), mission('b', 0, 7), mission('c', 0, 7)])!
    expect(hps(fresh)).toEqual([100, 100, 100])
    expect(fresh).toMatchObject({ front: 0, won: false, revenge: false, rejuvenator: false, ...laneForDay(DATE) })
    // 2/5 = 40 % → der Guardian hat noch 60 %; jede Mission macht Schaden, nicht nur die beste
    expect(hps(laneState(DATE, [mission('a', 2, 5), mission('b', 0, 7), mission('c', 0, 7)]))).toEqual([60, 100, 100])
    expect(hps(laneState(DATE, [mission('a', 2, 5), mission('b', 1, 7), mission('c', 0, 7)]))).toEqual([46, 100, 100])
    // 50 % + 50 % → Guardian fällt, auch ohne fertige Mission
    const half = laneState(DATE, [mission('a', 5, 10), mission('b', 1, 2), mission('c', 0, 7)])!
    expect(hps(half)).toEqual([0, 100, 100])
    expect(half.front).toBe(1)
    // 40 % + 71 % = 1,11 Missionen → Walker hat noch 89 %
    expect(hps(laneState(DATE, [mission('a', 2, 5), mission('b', 5, 7), mission('c', 0, 7)]))).toEqual([0, 89, 100])
  })

  it('der Patron fällt erst, wenn alle drei geschafft sind', () => {
    const almost = laneState(DATE, [mission('a', 5, 5, true), mission('b', 7, 7, true), mission('c', 6, 7)])!
    expect(hps(almost)).toEqual([0, 0, 15])
    expect(almost).toMatchObject({ front: 2, won: false })
    const won = laneState(DATE, [mission('a', 5, 5, true), mission('b', 7, 7, true), mission('c', 7, 7, true)])!
    expect(hps(won)).toEqual([0, 0, 0])
    expect(won).toMatchObject({ front: 3, won: true })
  })

  it('Gegner, Revanche, Held, Mid Boss und Rejuvenator kommen aus dem Kontext', () => {
    const other = laneForDay(DATE).patron === 'hiddenKing' ? 'archmother' : 'hiddenKing'
    const state = laneState(DATE, [mission('a', 0, 5), mission('b', 0, 7), mission('c', 0, 7)], {
      patron: other, revenge: true, rejuvenator: true, streak: 4,
      hero: { id: 'hero:hero_haze', name: 'Haze' }, midBoss: { title: '10 Schwächen-Karten üben', progress: 3, target: 10, done: false },
    })!
    expect(state).toMatchObject({ patron: other, lane: laneForDay(DATE).lane, revenge: true, rejuvenator: true, streak: 4 })
    expect(state.hero?.name).toBe('Haze')
    expect(state.midBoss).toMatchObject({ progress: 3, target: 10, done: false })
  })

  it('Leben aufgerundet: 0 % nur bei zerstörten Zielen', () => {
    expect(hpPercent(0)).toBe(0)
    expect(hpPercent(1)).toBe(100)
    expect(hpPercent(1 - 0.7)).toBe(30)
    expect(hpPercent(1 / 7)).toBe(15)
    expect(hpPercent(0.004)).toBe(1)
  })
})

describe('Änderungen für die Einblendungen', () => {
  const at = (...ms: LaneMission[]) => laneState(DATE, ms)!

  it('Schaden am vordersten Ziel', () => {
    const before = at(mission('a', 0, 10), mission('b', 0, 7), mission('c', 0, 7))
    const after = at(mission('a', 2, 10), mission('b', 0, 7), mission('c', 0, 7))
    expect(laneChange(before, after)).toMatchObject({ damage: { kind: 'guardian', before: 100, after: 80 }, destroyed: [], won: false, midBoss: false })
    expect(laneChange(after, after)).toBeNull()
    // anderer Tag oder kein vorheriger Stand: nichts einblenden
    expect(laneChange(null, after)).toBeNull()
    expect(laneChange({ ...before, date: '2026-11-05' }, after)).toBeNull()
  })

  it('zerstört – der Rest des Fortschritts trifft gleich das nächste Ziel', () => {
    const before = at(mission('a', 5, 10), mission('b', 4, 10), mission('c', 0, 7))
    const after = at(mission('a', 7, 10), mission('b', 4, 10), mission('c', 0, 7))
    expect(laneChange(before, after)).toMatchObject({ destroyed: ['guardian'], damage: { kind: 'walker', before: 100, after: 90 }, won: false })
  })

  it('Sieg, wenn der Patron fällt', () => {
    const before = at(mission('a', 10, 10, true), mission('b', 10, 10, true), mission('c', 6, 7))
    const after = at(mission('a', 10, 10, true), mission('b', 10, 10, true), mission('c', 7, 7, true))
    const change = laneChange(before, after)!
    expect(change).toMatchObject({ destroyed: ['patron'], won: true })
    expect(change.damage).toBeUndefined()
  })

  it('Mid Boss besiegt', () => {
    const ms = [mission('a', 0, 10), mission('b', 0, 7), mission('c', 0, 7)]
    const boss = (progress: number) => ({ title: 'Mid Boss', progress, target: 10, done: progress >= 10 })
    const before = laneState(DATE, ms, { midBoss: boss(9) })!
    const after = laneState(DATE, ms, { midBoss: boss(10), rejuvenator: true })!
    expect(laneChange(before, after)).toMatchObject({ midBoss: true, destroyed: [], won: false })
    expect(laneChange(after, after)).toBeNull()
  })

  it('trackLane meldet Änderungen gegenüber dem letzten Stand', () => {
    const seen: LaneChange[] = []
    const listener = (e: Event) => seen.push((e as CustomEvent<LaneChange>).detail)
    laneEvents.addEventListener('lane', listener)
    try {
      expect(trackLane(at(mission('a', 0, 10), mission('b', 0, 7), mission('c', 0, 7)))).toBeNull()
      expect(trackLane(at(mission('a', 5, 10), mission('b', 0, 7), mission('c', 0, 7)))?.damage).toMatchObject({ before: 100, after: 50 })
      expect(trackLane(at(mission('a', 5, 10), mission('b', 0, 7), mission('c', 0, 7)))).toBeNull()
      expect(seen).toHaveLength(1)
    } finally {
      laneEvents.removeEventListener('lane', listener)
    }
  })
})

describe('Animation auf der Startseite', () => {
  const fresh = laneState(DATE, [mission('a', 0, 10), mission('b', 0, 7), mission('c', 0, 7)])!
  const half = laneState(DATE, [mission('a', 5, 10), mission('b', 0, 7), mission('c', 0, 7)])!
  const one = laneState(DATE, [mission('a', 10, 10, true), mission('b', 0, 7), mission('c', 0, 7)])!

  it('vom zuletzt gezeigten Stand desselben Tages, sonst von vollen Leben', () => {
    expect(laneAnimationStart(null, fresh)).toBeNull()
    expect(laneAnimationStart(null, half)).toEqual({ date: DATE, hp: [1, 1, 1], won: false })
    expect(laneAnimationStart(shownOf(half), half)).toBeNull()
    expect(laneAnimationStart(shownOf(half), one)).toEqual(shownOf(half))
    expect(laneAnimationStart({ ...shownOf(one), date: '2026-11-05' }, half)).toEqual({ date: DATE, hp: [1, 1, 1], won: false })
  })

  it('nichts, wenn der Stand zurückgegangen ist (z. B. Fortschritt gelöscht)', () => {
    expect(laneAnimationStart(shownOf(one), half)).toBeNull()
    expect(laneAnimationStart(shownOf(one), fresh)).toBeNull()
  })

  it('gesehen = gleicher Tag und gleiche Prozente (nur dann wird nicht neu gespeichert)', () => {
    expect(isShown(shownOf(half), half)).toBe(true)
    expect(isShown({ ...shownOf(half), hp: [0.5000001, 1, 1] }, half)).toBe(true)
    expect(isShown(shownOf(half), one)).toBe(false)
    expect(isShown({ ...shownOf(half), date: '2026-11-05' }, half)).toBe(false)
    expect(isShown(null, fresh)).toBe(false)
  })
})

describe('Bilanz', () => {
  type Entry = Pick<SoulsEntry, 'date' | 'reason' | 'data'>
  const entry = (date: string, reason: SoulsEntry['reason'], data?: SoulsEntry['data']): Entry => ({ date, reason, ...(data ? { data } : {}) })
  const today = '2026-11-10'

  it('Sieg = Bonus für alle drei Missionen, Niederlage = gelernt oder gespielt ohne Sieg', () => {
    const entries = [
      entry('2026-11-01', 'missions'), // vor dem Start
      entry('2026-11-03', 'card'), entry('2026-11-03', 'mission'), entry('2026-11-03', 'missions'),
      entry('2026-11-04', 'card'), // Niederlage
      entry('2026-11-05', 'decay'), entry('2026-11-06', 'milestone'), // zählen nicht
      entry('2026-11-07', 'quiz'), entry('2026-11-07', 'missions'),
      entry(today, 'card'), // läuft noch
    ]
    expect(laneHistory(entries, null, today).days).toEqual([])
    const { days, summary } = laneHistory(entries, '2026-11-02', today)
    expect(days.map(d => [d.date, d.won])).toEqual([['2026-11-03', true], ['2026-11-04', false], ['2026-11-07', true]])
    expect(days[0]).toMatchObject({ ...laneForDay('2026-11-03'), revenge: false })
    expect(summary).toMatchObject({ wins: 2, losses: 1, streak: 1, best: 1 })
    // heute gewonnen → zählt gleich
    expect(laneHistory([...entries, entry(today, 'missions')], '2026-11-02', today).days.at(-1)).toMatchObject({ date: today, won: true })
  })

  it('Revanche: nach einer Niederlage kommt derselbe Patron wieder – auch über Tage ohne Lernen hinweg', () => {
    // Tage mit unterschiedlichem Patron suchen
    const lost = '2026-11-03'
    const next = ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'].find(d => laneForDay(d).patron !== laneForDay(lost).patron)!
    const entries = [entry(lost, 'card'), entry(next, 'quiz'), entry(next, 'missions', { patron: laneForDay(lost).patron, revenge: true }), entry('2026-11-09', 'card')]
    const { days, today: now } = laneHistory(entries, '2026-11-01', today)
    expect(days[0]).toMatchObject({ date: lost, won: false, revenge: false, patron: laneForDay(lost).patron })
    expect(days[1]).toMatchObject({ date: next, won: true, revenge: true, patron: laneForDay(lost).patron })
    // nach dem Sieg wieder der Patron des Tages
    expect(days[2]).toMatchObject({ date: '2026-11-09', won: false, revenge: false, patron: laneForDay('2026-11-09').patron })
    // heute: Revanche gegen den Patron vom 9.
    expect(now).toMatchObject({ revenge: true, patron: laneForDay('2026-11-09').patron })
  })

  it('ein Sieg zählt gegen den Gegner, gegen den er errungen wurde – auch wenn der Verlauf später anders aussieht', () => {
    const lost = '2026-11-03'
    const next = ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'].find(d => laneForDay(d).patron !== laneForDay(lost).patron)!
    const own = laneForDay(next).patron
    // gewonnen, als der Verlauf erst an diesem Tag begann (keine Revanche); danach rückt der Start nach vorn
    const recorded = laneHistory([entry(lost, 'card'), entry(next, 'missions', { patron: own, revenge: false })], '2026-11-01', today)
    expect(recorded.days[1]).toMatchObject({ date: next, won: true, revenge: false, patron: own })
    expect(recorded.summary.byPatron[own]).toEqual({ wins: 1, losses: 0 })
    // ältere Siege ohne Angabe: Patron des Tages, ohne Revanche
    const old = laneHistory([entry(lost, 'card'), entry(next, 'missions')], '2026-11-01', today)
    expect(old.days[1]).toMatchObject({ won: true, revenge: false, patron: own })
  })

  it('Rejuvenator: ein besiegter Mid Boss schützt die Serie bei der nächsten Niederlage (höchstens einer)', () => {
    const entries = [
      entry('2026-11-02', 'missions'),
      entry('2026-11-03', 'missions'), entry('2026-11-03', 'midboss'),
      entry('2026-11-04', 'midboss'), entry('2026-11-04', 'missions'), // zweiter Mid Boss: Vorrat bleibt bei einem
      entry('2026-11-05', 'card'), // Niederlage – geschützt
      entry('2026-11-06', 'missions'),
      entry('2026-11-07', 'card'), // Niederlage – kein Rejuvenator mehr
      entry('2026-11-08', 'missions'),
    ]
    const { days, summary, today: now } = laneHistory(entries, '2026-11-01', today)
    expect(days.find(d => d.date === '2026-11-05')).toMatchObject({ won: false, saved: true })
    expect(days.find(d => d.date === '2026-11-07')?.saved).toBeUndefined()
    expect(summary).toMatchObject({ wins: 5, losses: 2, streak: 1, best: 4, saves: 1 })
    expect(now.rejuvenator).toBe(false)
    // Mid Boss heute: Rejuvenator auf Vorrat
    expect(laneHistory([...entries, entry(today, 'midboss')], '2026-11-01', today).today.rejuvenator).toBe(true)
  })

  it('Siege je Held und Trophäen', () => {
    const wins = Array.from({ length: 5 }, (_, i) => `2026-10-${String(10 + i * 2).padStart(2, '0')}`)
    const entries: Entry[] = []
    for (const [i, d] of wins.entries()) entries.push(entry(d, 'missions', { hero: i < 3 ? 'hero:hero_haze' : 'hero:hero_wraith' }))
    const { summary } = laneHistory(entries, '2026-10-01', today)
    expect(summary.byHero).toEqual({ 'hero:hero_haze': 3, 'hero:hero_wraith': 2 })
    // Trophäe nur am Tag des Sieges, bei 1, 5, 10, 25, 50 Siegen gegen diesen Patron
    const first = laneHistory([entry(today, 'missions')], '2026-11-01', today)
    expect(laneContextOf(first, today)).toMatchObject({ trophy: 1, streak: 1 })
    expect(laneContextOf(laneHistory([entry('2026-11-09', 'missions')], '2026-11-01', today), today).trophy).toBeUndefined()
    expect(TROPHY_WINS).toEqual([1, 5, 10, 25, 50])
  })

  it('Serien-Bonus: +10 je Tag, höchstens +100, bei einer Revanche doppelt', () => {
    expect(streakBonus(1, false)).toBe(10)
    expect(streakBonus(7, false)).toBe(70)
    expect(streakBonus(14, false)).toBe(100)
    expect(streakBonus(3, true)).toBe(60)
    expect(streakBonus(20, true)).toBe(200)
  })

  it('liest Souls-Verlauf und Start aus der Datenbank', async () => {
    const database = new DeckDB(`l-${Math.random()}`)
    await database.souls.bulkAdd([
      { at: 1, date: '2026-11-08', amount: 10, reason: 'card' },
      { at: 2, date: '2026-11-09', amount: 150, reason: 'missions' },
    ])
    expect(await getLaneSummary(new Date(2026, 10, 10, 12), database)).toMatchObject({ wins: 0, losses: 0 })
    await database.meta.put({ key: 'laneStart', value: '2026-11-08' })
    expect(await getLaneSummary(new Date(2026, 10, 10, 12), database)).toMatchObject({ wins: 1, losses: 1, streak: 1 })
    expect(await getMeta('laneStart', null, database)).toBe('2026-11-08')
  })
})

describe('Ziele auf der Map', () => {
  const p = (kind: MapPoint['kind'], x: number, y: number, lane?: MapPoint['lane']): MapPoint => ({ kind, x, y, ...(lane ? { lane } : {}) })
  const data: MapData = {
    image: 'map.png',
    ziplines: [],
    points: [
      p('guardian', 0.17, 0.41, 'yellow'), p('guardian', 0.12, 0.59, 'yellow'), p('guardian', 0.5, 0.42, 'blue'),
      p('walker', 0.25, 0.27, 'yellow'), p('walker', 0.21, 0.72, 'yellow'), p('walker', 0.56, 0.34, 'blue'),
      p('patron', 0.56, 0.13), p('patron', 0.44, 0.87), p('campSmall', 0.2, 0.3),
    ],
  }

  it('Guardian und Walker der Lane in der oberen Basis, dazu der obere Patron', () => {
    expect(laneTargetPoints(data, 'yellow')).toEqual({
      guardian: data.points[0], walker: data.points[3], patron: data.points[6],
    })
    expect(laneTargetPoints(data, 'blue')).toEqual({ guardian: data.points[2], walker: data.points[5], patron: data.points[6] })
    // fehlt etwas in den Daten, fehlt nur dieses Ziel
    expect(laneTargetPoints(data, 'green')).toEqual({ patron: data.points[6] })
  })
})
