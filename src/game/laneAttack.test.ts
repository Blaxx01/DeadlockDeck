import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { addDays } from '../data/dates'
import { DeckDB, getMeta } from '../data/db'
import type { MapData, MapPoint } from '../map/mapData'
import {
  ATTACK_LANES, getLaneSummary, hpPercent, isShown, laneAnimationStart, laneChange, laneDays, laneEvents, laneForDay, laneState,
  laneTargetPoints, PATRONS, shownOf, summarizeLanes, trackLane, type LaneChange, type LaneMission, type LaneState,
} from './laneAttack'
import type { SoulsEntry } from './souls'

const DATE = '2026-11-06'

function mission(id: string, progress: number, target: number, done = false, doneSeq?: number): LaneMission {
  return { def: { id, title: `Mission ${id}`, target }, progress, done, doneSeq }
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

  it('volle Leben ohne Fortschritt; Schaden = die am weitesten fortgeschrittene offene Mission', () => {
    const fresh = laneState(DATE, [mission('a', 0, 5), mission('b', 0, 7), mission('c', 0, 7)])!
    expect(hps(fresh)).toEqual([100, 100, 100])
    expect(fresh).toMatchObject({ front: 0, won: false, ...laneForDay(DATE) })
    // 2/5 = 40 %, 5/7 = 71 % → der Guardian hat noch 29 %
    expect(hps(laneState(DATE, [mission('a', 2, 5), mission('b', 5, 7), mission('c', 0, 7)]))).toEqual([29, 100, 100])
  })

  it('jede geschaffte Mission zerstört das vorderste Ziel – in der Reihenfolge des Schaffens', () => {
    // b zuerst geschafft (Eintrag 10), dann a (Eintrag 20)
    const one = laneState(DATE, [mission('a', 2, 5), mission('b', 7, 7, true, 10), mission('c', 0, 7)])!
    expect(hps(one)).toEqual([0, 60, 100])
    expect(one.targets[0].by).toBe('Mission b')
    expect(one.front).toBe(1)
    const two = laneState(DATE, [mission('a', 5, 5, true, 20), mission('b', 7, 7, true, 10), mission('c', 3, 7)])!
    expect(two.targets.map(t => t.by)).toEqual(['Mission b', 'Mission a', undefined])
    expect(hps(two)).toEqual([0, 0, 58])
    // gerade erst geschafft (noch nicht belohnt) kommt nach den belohnten
    const fresh = laneState(DATE, [mission('a', 5, 5, true), mission('b', 7, 7, true, 10), mission('c', 0, 7)])!
    expect(fresh.targets.map(t => t.by)).toEqual(['Mission b', 'Mission a', undefined])
    const won = laneState(DATE, [mission('a', 5, 5, true, 20), mission('b', 7, 7, true, 10), mission('c', 7, 7, true, 30)])!
    expect(won).toMatchObject({ front: 3, won: true })
    expect(won.targets.map(t => t.by)).toEqual(['Mission b', 'Mission a', 'Mission c'])
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
    expect(laneChange(before, after)).toMatchObject({ damage: { kind: 'guardian', before: 100, after: 80 }, destroyed: [], won: false })
    expect(laneChange(after, after)).toBeNull()
    // anderer Tag oder kein vorheriger Stand: nichts einblenden
    expect(laneChange(null, after)).toBeNull()
    expect(laneChange({ ...before, date: '2026-11-05' }, after)).toBeNull()
  })

  it('zerstört – das nächste Ziel zeigt gleich den Stand der nächstbesten Mission', () => {
    const before = at(mission('a', 9, 10), mission('b', 4, 10), mission('c', 0, 7))
    const after = at(mission('a', 10, 10, true), mission('b', 4, 10), mission('c', 0, 7))
    expect(laneChange(before, after)).toMatchObject({ destroyed: ['guardian'], damage: { kind: 'walker', before: 100, after: 60 }, won: false })
  })

  it('Sieg, wenn der Patron fällt', () => {
    const before = at(mission('a', 10, 10, true, 1), mission('b', 10, 10, true, 2), mission('c', 6, 7))
    const after = at(mission('a', 10, 10, true, 1), mission('b', 10, 10, true, 2), mission('c', 7, 7, true))
    const change = laneChange(before, after)!
    expect(change).toMatchObject({ destroyed: ['patron'], won: true })
    expect(change.damage).toBeUndefined()
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
  const one = laneState(DATE, [mission('a', 10, 10, true, 1), mission('b', 0, 7), mission('c', 0, 7)])!

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
  const entry = (date: string, reason: SoulsEntry['reason']) => ({ date, reason })
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
    expect(laneDays(entries, null, today)).toEqual([])
    const days = laneDays(entries, '2026-11-02', today)
    expect(days.map(d => [d.date, d.won])).toEqual([['2026-11-03', true], ['2026-11-04', false], ['2026-11-07', true]])
    expect(days[0]).toMatchObject(laneForDay('2026-11-03'))
    // heute gewonnen → zählt gleich
    expect(laneDays([...entries, entry(today, 'missions')], '2026-11-02', today).at(-1)).toMatchObject({ date: today, won: true })
  })

  it('Siegesserie: Tage ohne Lernen und der laufende Tag unterbrechen nicht', () => {
    const day = (date: string, won: boolean) => ({ date, won, ...laneForDay(date) })
    const days = [
      day('2026-11-01', true), day('2026-11-02', true), day('2026-11-03', true), day('2026-11-04', false),
      day('2026-11-06', true), day('2026-11-09', true),
    ]
    const summary = summarizeLanes(days)
    expect(summary).toMatchObject({ wins: 5, losses: 1, streak: 2, best: 3 })
    const hk = days.filter(d => d.patron === 'hiddenKing')
    expect(summary.byPatron.hiddenKing).toEqual({ wins: hk.filter(d => d.won).length, losses: hk.filter(d => !d.won).length })
    expect(summary.byPatron.hiddenKing.wins + summary.byPatron.archmother.wins).toBe(5)
    expect(summarizeLanes([])).toMatchObject({ wins: 0, losses: 0, streak: 0, best: 0 })
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
