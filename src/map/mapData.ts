/**
 * Map-Wissen: Minimap und Objekte aus der API (`/v1/assets/map`) als kompaktes Modell.
 * Positionen relativ zur Karte (0–1, links/oben); die Map steht immer gleich herum.
 */

/** Bereiche (Ebenen auf der Map-Seite, Auswahl im Map-Quiz) */
export type MapGroup = 'objectives' | 'camps' | 'orientation' | 'movement' | 'breakables'

export const MAP_GROUPS: MapGroup[] = ['objectives', 'camps', 'orientation', 'movement', 'breakables']

export const MAP_GROUP_LABEL: Record<MapGroup, string> = {
  objectives: 'Lanes & Ziele',
  camps: 'Camps & Vaults',
  orientation: 'Orientierung',
  movement: 'Bewegung',
  breakables: 'Kisten & Statuen',
}

/** Bereiche des Map-Quiz (Kisten & Statuen nur auf der Map-Seite – zu viele) */
export const MAP_QUIZ_GROUPS: MapGroup[] = ['objectives', 'camps', 'orientation', 'movement']

export type MapKind =
  | 'guardian' | 'walker' | 'patron' | 'midBoss'
  | 'campSmall' | 'campMedium' | 'campLarge' | 'vault'
  | 'laneShop' | 'baseShop' | 'secretShop' | 'teleporter' | 'urnSpawn' | 'urnDelivery' | 'bridgeBuff'
  | 'climbRope' | 'bouncePad' | 'steamVent' | 'veil'
  | 'crate' | 'toughCrate' | 'goldenStatue' | 'healingPickup'

export interface MapKindInfo {
  /** Name wie ingame (englisch) bzw. deutsche Beschreibung, wo es keinen festen Namen gibt */
  label: string
  group: MapGroup
  /** Für „Tippe auf …“: Akkusativ mit Artikel */
  accusative: string
  /** Ein Satz, was es tut – nur, wo sicher */
  info?: string
}

export const MAP_KINDS: Record<MapKind, MapKindInfo> = {
  guardian: { label: 'Guardian', group: 'objectives', accusative: 'einen Guardian', info: 'Erster Turm jeder Lane – verteidigt sie, bis er fällt.' },
  walker: { label: 'Walker', group: 'objectives', accusative: 'einen Walker', info: 'Großer zweiter Turm jeder Lane, deutlich stärker als der Guardian.' },
  patron: { label: 'Patron', group: 'objectives', accusative: 'einen Patron', info: 'Hauptziel in der Basis: Wer den gegnerischen Patron zerstört, gewinnt.' },
  midBoss: { label: 'Mid Boss', group: 'objectives', accusative: 'den Mid Boss', info: 'Neutraler Boss in der Kartenmitte – wer ihn besiegt, bekommt den Rejuvenator fürs Team.' },
  campSmall: { label: 'Kleines Camp', group: 'camps', accusative: 'ein kleines Camp', info: 'Schwache neutrale Gegner – schnelle Souls abseits der Lane.' },
  campMedium: { label: 'Mittleres Camp', group: 'camps', accusative: 'ein mittleres Camp', info: 'Neutrale Gegner, mehr Souls als im kleinen Camp.' },
  campLarge: { label: 'Großes Camp', group: 'camps', accusative: 'ein großes Camp', info: 'Starke neutrale Gegner – viele Souls, aber gefährlich.' },
  vault: { label: "Sinner's Sacrifice", group: 'camps', accusative: "einen Sinner's Sacrifice", info: 'Neutrale Soul-Quelle abseits der Lanes – angreifen bringt Souls.' },
  laneShop: { label: 'Lane-Shop', group: 'orientation', accusative: 'einen Lane-Shop', info: 'Shop an der Lane – Items kaufen, ohne zur Basis zurückzumüssen.' },
  baseShop: { label: 'Basis-Shop', group: 'orientation', accusative: 'einen Basis-Shop', info: 'Shop in der Basis.' },
  secretShop: { label: 'Secret Shop', group: 'orientation', accusative: 'einen Secret Shop', info: 'Versteckter Shop abseits der Lanes.' },
  teleporter: { label: 'Teleporter', group: 'orientation', accusative: 'einen Teleporter', info: 'Bringt dich zum Teleporter auf der anderen Seite der Map.' },
  urnSpawn: { label: 'Urne (Spawn)', group: 'orientation', accusative: 'eine Stelle, an der die Urne erscheint', info: 'Hier erscheint die Seelenurne.' },
  urnDelivery: { label: 'Urne (Abgabe)', group: 'orientation', accusative: 'eine Abgabestelle für die Urne', info: 'Hierher getragen bringt die Urne Souls fürs Team.' },
  bridgeBuff: { label: 'Brücken-Buff', group: 'orientation', accusative: 'einen Brücken-Buff', info: 'Hier erscheinen Power-ups mit einem befristeten Bonus.' },
  climbRope: { label: 'Kletterseil', group: 'movement', accusative: 'ein Kletterseil', info: 'Seil zum Hochklettern.' },
  bouncePad: { label: 'Sprungpad', group: 'movement', accusative: 'ein Sprungpad', info: 'Schleudert dich zu einem anderen Punkt.' },
  steamVent: { label: 'Dampfdüse', group: 'movement', accusative: 'eine Dampfdüse' },
  veil: { label: 'Veil', group: 'movement', accusative: 'einen Veil', info: 'Vorhang: Man kann hindurchgehen, aber nicht hindurchsehen.' },
  crate: { label: 'Kiste', group: 'breakables', accusative: 'eine Kiste', info: 'Zerstörbar – lässt Souls fallen.' },
  toughCrate: { label: 'Harte Kiste', group: 'breakables', accusative: 'eine harte Kiste' },
  goldenStatue: { label: 'Goldene Statue', group: 'breakables', accusative: 'eine goldene Statue' },
  healingPickup: { label: 'Heil-Pickup', group: 'breakables', accusative: 'ein Heil-Pickup', info: 'Heilt beim Aufsammeln.' },
}

export const MAP_KIND_ORDER = Object.keys(MAP_KINDS) as MapKind[]

/** Lanes, benannt nach der Farbe ihrer Zipline */
export type Lane = 'yellow' | 'blue' | 'green' | 'purple'

export const LANE_LABEL: Record<Lane, string> = { yellow: 'Gelb', blue: 'Blau', green: 'Grün', purple: 'Lila' }

export interface MapPos {
  x: number
  y: number
}

export interface MapPoint extends MapPos {
  kind: MapKind
  lane?: Lane
  /** Teleporter, Sprungpad: wohin es führt */
  to?: MapPos
}

export interface MapLine {
  lane: Lane
  /** Farbe aus der API (#rrggbb) */
  color: string
  points: MapPos[]
}

export interface MapData {
  /** Minimap (dunkle Fläche = begehbar, durchsichtig = Gebäude) */
  image: string
  points: MapPoint[]
  ziplines: MapLine[]
}

/** Mid Boss: fehlt in der API – von Hand in der Kartenmitte */
export const MID_BOSS: MapPoint = { kind: 'midBoss', x: 0.5, y: 0.5 }

// ---------- API ----------

interface ApiRel {
  left_relative: number
  top_relative: number
}

interface ApiEntity extends ApiRel {
  position?: number[]
  target?: number[]
  kind?: string
  team?: number | null
}

export interface ApiMap {
  radius: number
  images: Record<string, string>
  objective_positions: Record<string, ApiRel>
  zipline_paths?: { origin: number[]; color: string; P0_points: number[][] }[]
  neutral_camps?: (ApiRel & { kind: string })[]
  entities?: Record<string, ApiEntity[]>
}

const round = (v: number) => Math.round(v * 10_000) / 10_000
const posOf = (e: ApiRel): MapPos => ({ x: round(e.left_relative), y: round(e.top_relative) })

/** Welt-Koordinaten (Einheiten des Spiels) → relativ zur Karte */
function worldToMap(radius: number, wx: number, wy: number): MapPos {
  return { x: round((wx + radius) / (2 * radius)), y: round((radius - wy) / (2 * radius)) }
}

/** Farbname einer Lane aus der Zipline-Farbe (Farbton) */
export function laneOfColor(hex: string): Lane | undefined {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!m) return undefined
  const [r, g, b] = m.slice(1).map(v => Number.parseInt(v, 16) / 255)
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  if (d < 0.1) return undefined
  const hue = (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60
  const h = (hue + 360) % 360
  if (h >= 35 && h < 75) return 'yellow'
  if (h >= 75 && h < 165) return 'green'
  if (h >= 165 && h < 255) return 'blue'
  if (h >= 255 && h < 330) return 'purple'
  return undefined
}

const CAMP_KIND: Record<string, MapKind> = { weak: 'campSmall', medium: 'campMedium', strong: 'campLarge', vault: 'vault' }
const SHOP_KIND: Record<string, MapKind> = { lane: 'laneShop', base: 'baseShop', secret: 'secretShop' }
const ENTITY_KIND: Record<string, MapKind> = {
  teleporters: 'teleporter',
  soul_urn_spawns: 'urnSpawn',
  soul_urn_pads: 'urnDelivery',
  bridge_buffs: 'bridgeBuff',
  climb_ropes: 'climbRope',
  bounce_pads: 'bouncePad',
  steam_vents: 'steamVent',
  cosmic_veils: 'veil',
  crates: 'crate',
  tough_crates: 'toughCrate',
  golden_statues: 'goldenStatue',
  healing_snacks: 'healingPickup',
}
const OBJECTIVE = /^team(\d)_(tier1|tier2|titan)(?:_(\d+))?$/

/**
 * API → Modell. Lanes: Jede Zipline gehört zur Lane, deren Guardians und Walker ihr am nächsten liegen.
 * Wirft, wenn Wesentliches fehlt (dann bleibt der alte Stand).
 */
export function parseMapData(api: ApiMap): MapData {
  const image = api.images?.minimap ?? api.images?.plain
  const radius = api.radius
  if (!image || !(radius > 0) || !api.objective_positions) throw new Error('Map-Daten unvollständig')

  const objectives = Object.entries(api.objective_positions).flatMap(([key, rel]) => {
    const m = OBJECTIVE.exec(key)
    if (!m) return []
    const kind: MapKind = m[2] === 'tier1' ? 'guardian' : m[2] === 'tier2' ? 'walker' : 'patron'
    return [{ kind, laneNo: m[3], ...posOf(rel) }]
  })
  if (!objectives.some(o => o.kind === 'guardian')) throw new Error('Map-Daten ohne Lanes')

  // Ziplines: Punkte relativ zur Karte, Lane über die nächsten Lane-Ziele
  const laneOfNo = new Map<string, Lane>()
  const ziplines: MapLine[] = []
  for (const z of api.zipline_paths ?? []) {
    const lane = laneOfColor(z.color)
    if (!lane || !z.origin || !z.P0_points?.length) continue
    const points = z.P0_points.map(p => worldToMap(radius, z.origin[0] + p[0], z.origin[1] + p[1]))
    ziplines.push({ lane, color: z.color, points })
    const laneNos = [...new Set(objectives.filter(o => o.laneNo).map(o => o.laneNo!))]
    const meanDist = (no: string) => {
      const objs = objectives.filter(o => o.laneNo === no)
      return objs.reduce((sum, o) => sum + Math.min(...points.map(p => Math.hypot(p.x - o.x, p.y - o.y))), 0) / objs.length
    }
    const best = laneNos.sort((a, b) => meanDist(a) - meanDist(b))[0]
    if (best !== undefined && !laneOfNo.has(best)) laneOfNo.set(best, lane)
  }

  const points: MapPoint[] = objectives.map(({ kind, laneNo, x, y }) => {
    const lane = laneNo ? laneOfNo.get(laneNo) : undefined
    return lane ? { kind, x, y, lane } : { kind, x, y }
  })
  points.push(MID_BOSS)
  for (const camp of api.neutral_camps ?? []) {
    const kind = CAMP_KIND[camp.kind]
    if (kind) points.push({ kind, ...posOf(camp) })
  }
  const entities = api.entities ?? {}
  for (const shop of entities.shops ?? []) {
    const kind = shop.kind ? SHOP_KIND[shop.kind] : undefined
    if (kind) points.push({ kind, ...posOf(shop) })
  }
  for (const [key, kind] of Object.entries(ENTITY_KIND)) {
    for (const e of entities[key] ?? []) {
      const point: MapPoint = { kind, ...posOf(e) }
      if (e.target?.length && e.target.length >= 2) point.to = worldToMap(radius, e.target[0], e.target[1])
      points.push(point)
    }
  }
  // Lanes von links nach rechts (Legende, Reihenfolge)
  const meanX = (line: MapLine) => line.points.reduce((sum, p) => sum + p.x, 0) / line.points.length
  ziplines.sort((a, b) => meanX(a) - meanX(b))
  return { image, points, ziplines }
}

/** Anzahl je Art */
export function countKinds(data: MapData): Map<MapKind, number> {
  const counts = new Map<MapKind, number>()
  for (const p of data.points) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1)
  return counts
}

/** Nächstes Objekt zu einer Stelle (relativ), mit Abstand */
export function nearestPoint(points: readonly MapPoint[], pos: MapPos): { point: MapPoint; distance: number } | undefined {
  let best: { point: MapPoint; distance: number } | undefined
  for (const point of points) {
    const distance = Math.hypot(point.x - pos.x, point.y - pos.y)
    if (!best || distance < best.distance) best = { point, distance }
  }
  return best
}
