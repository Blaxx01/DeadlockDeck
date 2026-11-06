import { describe, expect, it } from 'vitest'
import { MAP_KINDS, type MapData, type MapKind, type MapPoint } from './mapData'
import { buildMapRound, checkTap, TAP_TOLERANCE, WHERE_MAX } from './mapQuiz'

/** Deterministischer Zufall (mulberry32) */
function seeded(seed = 1) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const COUNTS: Partial<Record<MapKind, number>> = {
  guardian: 6, walker: 6, patron: 2, midBoss: 1, campSmall: 4, campMedium: 25, campLarge: 11, vault: 11,
  laneShop: 6, baseShop: 1, secretShop: 2, teleporter: 4, urnSpawn: 6, bridgeBuff: 2,
  climbRope: 17, bouncePad: 17, steamVent: 47, veil: 30, crate: 60,
}

/** Punkte über die Karte verteilt (fester Zufall); Urnen-Abgaben direkt neben zwei Urnen-Spawns */
function map(): MapData {
  const rng = seeded(99)
  const points: MapPoint[] = []
  for (const [kind, n] of Object.entries(COUNTS) as [MapKind, number][]) {
    for (let i = 0; i < n; i++) points.push({ kind, x: 0.1 + rng() * 0.8, y: 0.1 + rng() * 0.8 })
  }
  const spawns = points.filter(p => p.kind === 'urnSpawn').slice(0, 2)
  for (const s of spawns) points.push({ kind: 'urnDelivery', x: s.x + 0.005, y: s.y })
  return { image: 'map.png', points, ziplines: [] }
}

const ALL_GROUPS = ['objectives', 'camps', 'orientation', 'movement'] as const

describe('Map-Quiz: Tippen', () => {
  it('richtig bis etwa einen Fingerbreit neben einem Objekt der Art', () => {
    const data = map()
    const tp = data.points.find(p => p.kind === 'teleporter')!
    expect(checkTap(data, 'teleporter', { x: tp.x + TAP_TOLERANCE * 0.9, y: tp.y }).correct).toBe(true)
    const others = data.points.filter(p => p.kind === 'teleporter')
    const far = { x: 0.02, y: 0.98 }
    expect(others.every(p => Math.hypot(p.x - far.x, p.y - far.y) > TAP_TOLERANCE)).toBe(true)
    expect(checkTap(data, 'teleporter', far)).toMatchObject({ correct: false })
  })
})

describe('Map-Quiz: Runden', () => {
  it('10 Fragen, jede Art einmal; „Wo ist …?“ nur für seltene Arten; nie Kisten', () => {
    const data = map()
    const count = (kind: MapKind) => data.points.filter(p => p.kind === kind).length
    for (let seed = 1; seed <= 20; seed++) {
      const round = buildMapRound(data, [...ALL_GROUPS], ['where', 'what'], seeded(seed))
      expect(round).toHaveLength(10)
      expect(new Set(round.map(q => q.kind)).size).toBe(10)
      expect(round.some(q => q.kind === 'crate')).toBe(false)
      for (const q of round.filter(q => q.type === 'where')) {
        expect(count(q.kind)).toBeLessThanOrEqual(WHERE_MAX)
        expect(q.prompt).toBe(`Tippe auf ${MAP_KINDS[q.kind].accusative}.`)
      }
      expect(new Set(round.map(q => q.type))).toEqual(new Set(['where', 'what']))
    }
  })

  it('„Was ist hier?“: 4 verschiedene Arten, richtige dabei, bevorzugt aus demselben Bereich, nie eine von derselben Stelle', () => {
    const data = map()
    for (let seed = 1; seed <= 40; seed++) {
      for (const q of buildMapRound(data, [...ALL_GROUPS], ['what'], seeded(seed))) {
        expect(q.options).toHaveLength(4)
        expect(new Set(q.options).size).toBe(4)
        expect(q.options![q.answer!]).toBe(q.kind)
        expect(data.points.some(p => p.kind === q.kind && p.x === q.spot!.x && p.y === q.spot!.y)).toBe(true)
        const wrong = q.options!.filter(k => k !== q.kind)
        const nearSpot = (k: MapKind) => data.points.some(p => p.kind === k && Math.hypot(p.x - q.spot!.x, p.y - q.spot!.y) <= TAP_TOLERANCE)
        for (const k of wrong) expect(nearSpot(k)).toBe(false)
        // aus demselben Bereich, soweit dort genug Arten nicht an derselben Stelle liegen
        const group = MAP_KINDS[q.kind].group
        const sameGroup = (Object.keys(MAP_KINDS) as MapKind[]).filter(k => k !== q.kind && MAP_KINDS[k].group === group && data.points.some(p => p.kind === k) && !nearSpot(k))
        expect(wrong.filter(k => MAP_KINDS[k].group === group)).toHaveLength(Math.min(3, sameGroup.length))
      }
    }
  })

  it('nur gewählte Bereiche und Fragetypen; wenige Arten: Wiederholung, aber nie direkt hintereinander', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const round = buildMapRound(map(), ['camps'], ['where'], seeded(seed))
      expect(round).toHaveLength(10)
      expect(round.every(q => q.type === 'where' && ['campSmall', 'campLarge', 'vault'].includes(q.kind))).toBe(true)
      expect(round.every((q, i) => i === 0 || q.kind !== round[i - 1].kind)).toBe(true)
    }
    expect(buildMapRound(map(), ['movement'], ['what'], seeded(3)).every(q => MAP_KINDS[q.kind].group === 'movement')).toBe(true)
  })

  it('ohne passende Arten keine Runde', () => {
    const onlyMany: MapData = { image: 'm.png', ziplines: [], points: Array.from({ length: 30 }, (_, i) => ({ kind: 'steamVent' as const, x: i / 30, y: 0.5 })) }
    expect(buildMapRound(onlyMany, ['movement'], ['where'], seeded())).toEqual([])
    expect(buildMapRound(map(), [], ['where', 'what'], seeded())).toEqual([])
    expect(buildMapRound(map(), [...ALL_GROUPS], [], seeded())).toEqual([])
  })
})
