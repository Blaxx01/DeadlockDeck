import { describe, expect, it } from 'vitest'
import { countKinds, laneOfColor, MID_BOSS, parseMapData, type ApiMap } from './mapData'

const R = 10_000
/** Welt-Koordinaten zu einer relativen Position (Umkehrung von worldToMap) */
const world = (x: number, y: number) => [x * 2 * R - R, R - y * 2 * R, 0]
const rel = (x: number, y: number) => ({ left_relative: x, top_relative: y })
/** Zipline senkrecht bei x (von oben nach unten), Punkte relativ zum Ursprung */
function zipline(x: number, color: string) {
  const origin = world(x, 0)
  const points = [0, 0.25, 0.5, 0.75, 1].map(y => { const [wx, wy] = world(x, y); return [wx - origin[0], wy - origin[1], 0] })
  return { origin, color, P0_points: points }
}

const API: ApiMap = {
  radius: R,
  images: { minimap: 'https://cdn/minimap.png', plain: 'https://cdn/plain.png' },
  objective_positions: {
    team0_core: rel(0.3, 0.95),
    team0_titan: rel(0.5, 0.85), team1_titan: rel(0.5, 0.15),
    team0_tier1_1: rel(0.12, 0.55), team1_tier1_1: rel(0.12, 0.45), team0_tier2_1: rel(0.12, 0.7), team1_tier2_1: rel(0.12, 0.3),
    team0_tier1_3: rel(0.5, 0.55), team1_tier1_3: rel(0.5, 0.45), team0_tier2_3: rel(0.5, 0.7), team1_tier2_3: rel(0.5, 0.3),
    team0_tier1_4: rel(0.88, 0.55), team1_tier1_4: rel(0.88, 0.45), team0_tier2_4: rel(0.88, 0.7), team1_tier2_4: rel(0.88, 0.3),
  },
  zipline_paths: [zipline(0.86, '#59b247'), zipline(0.1, '#F1CC30'), zipline(0.52, '#29b1cc')],
  neutral_camps: [{ ...rel(0.3, 0.6), kind: 'weak' }, { ...rel(0.7, 0.4), kind: 'vault' }, { ...rel(0.2, 0.2), kind: 'unknown' }],
  entities: {
    shops: [{ ...rel(0.1, 0.6), kind: 'lane', team: 0 }, { ...rel(0.32, 0.45), kind: 'secret', team: null }],
    teleporters: [{ ...rel(0.3, 0.4), target: world(0.7, 0.6) }],
    crates: [{ ...rel(0.4, 0.4), kind: 'wooden_crate' }],
    bells: [{ ...rel(0.6, 0.6), kind: 'bell' }],
  },
}

describe('Map-Daten', () => {
  it('Lanes aus den Zipline-Farben, zugeordnet über die nächsten Guardians und Walker', () => {
    const map = parseMapData(API)
    expect(map.image).toBe('https://cdn/minimap.png')
    const lanes = (kind: string) => map.points.filter(p => p.kind === kind).map(p => `${p.x}:${p.lane}`).sort()
    expect(lanes('guardian')).toEqual(['0.12:yellow', '0.12:yellow', '0.5:blue', '0.5:blue', '0.88:green', '0.88:green'])
    expect(lanes('walker')).toHaveLength(6)
    expect(map.points.filter(p => p.kind === 'patron').every(p => p.lane === undefined)).toBe(true)
    // von links nach rechts
    expect(map.ziplines.map(z => z.lane)).toEqual(['yellow', 'blue', 'green'])
    expect(map.ziplines[0].points[0]).toEqual({ x: 0.1, y: 0 })
    expect(map.ziplines[0].points.at(-1)).toEqual({ x: 0.1, y: 1 })
  })

  it('Camps, Shops, Teleporter mit Ziel; Mid Boss von Hand; Unbekanntes und Cores fallen weg', () => {
    const map = parseMapData(API)
    const counts = Object.fromEntries(countKinds(map))
    expect(counts).toEqual({ guardian: 6, walker: 6, patron: 2, midBoss: 1, campSmall: 1, vault: 1, laneShop: 1, secretShop: 1, teleporter: 1, crate: 1 })
    expect(map.points).toContainEqual(MID_BOSS)
    expect(map.points.find(p => p.kind === 'teleporter')).toEqual({ kind: 'teleporter', x: 0.3, y: 0.4, to: { x: 0.7, y: 0.6 } })
  })

  it('ohne Bild oder Lanes: Fehler (alter Stand bleibt)', () => {
    expect(() => parseMapData({ ...API, images: {} })).toThrow()
    expect(() => parseMapData({ ...API, objective_positions: { team0_titan: rel(0.5, 0.9) } })).toThrow()
  })

  it('Lane-Farbe am Farbton', () => {
    expect(['#F1CC30', '#29b1cc', '#59b247', '#8a4fd6', '#808080', 'kaputt'].map(laneOfColor)).toEqual(['yellow', 'blue', 'green', 'purple', undefined, undefined])
  })
})
