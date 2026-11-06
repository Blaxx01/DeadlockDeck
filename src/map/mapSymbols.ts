/** Wie die Map-Objekte gezeichnet werden (Form, Größe in Karten-Einheiten von 1000, Farbe, Buchstabe) */
import type { Lane, MapKind } from './mapData'

export type SymbolShape = 'circle' | 'ring' | 'square' | 'diamond' | 'triangle' | 'bar'

export interface MapSymbol {
  shape: SymbolShape
  /** Radius bzw. halbe Kantenlänge */
  size: number
  color: string
  /** Buchstabe im Symbol (große Ziele) */
  glyph?: string
}

/** Lane-Farben, falls die API keine liefert (Guardians/Walker ohne Zipline) */
export const LANE_COLOR: Record<Lane, string> = { yellow: '#f1cc30', blue: '#29b1cc', green: '#59b247', purple: '#a774e8' }
const NO_LANE = '#c8bba5'

export const MAP_SYMBOLS: Record<MapKind, MapSymbol> = {
  guardian: { shape: 'circle', size: 15, color: NO_LANE, glyph: 'G' },
  walker: { shape: 'square', size: 15, color: NO_LANE, glyph: 'W' },
  patron: { shape: 'circle', size: 20, color: '#e0b25c', glyph: 'P' },
  midBoss: { shape: 'circle', size: 20, color: '#c174f0', glyph: 'M' },
  campSmall: { shape: 'circle', size: 7, color: '#a7d98a' },
  campMedium: { shape: 'circle', size: 9, color: '#6fc04f' },
  campLarge: { shape: 'circle', size: 11, color: '#3d9a35' },
  vault: { shape: 'square', size: 10, color: '#f2c14e' },
  laneShop: { shape: 'square', size: 11, color: '#5ad1e6' },
  baseShop: { shape: 'square', size: 13, color: '#9be7f3' },
  secretShop: { shape: 'diamond', size: 13, color: '#5ad1e6' },
  teleporter: { shape: 'ring', size: 12, color: '#c58cff' },
  urnSpawn: { shape: 'circle', size: 8, color: '#ff9f43' },
  urnDelivery: { shape: 'ring', size: 13, color: '#ff9f43' },
  bridgeBuff: { shape: 'diamond', size: 11, color: '#ff6fae' },
  climbRope: { shape: 'bar', size: 9, color: '#f3e9d6' },
  bouncePad: { shape: 'triangle', size: 9, color: '#ffb35c' },
  steamVent: { shape: 'circle', size: 5, color: '#b9c4cc' },
  veil: { shape: 'square', size: 5, color: '#9d7ad8' },
  crate: { shape: 'circle', size: 3, color: '#b07a45' },
  toughCrate: { shape: 'circle', size: 4, color: '#7a4f28' },
  goldenStatue: { shape: 'circle', size: 4, color: '#ffd700' },
  healingPickup: { shape: 'circle', size: 4, color: '#4ade80' },
}

/** Farbe eines Symbols (Guardians und Walker in ihrer Lane-Farbe) */
export function symbolColor(kind: MapKind, lane?: Lane): string {
  return lane && (kind === 'guardian' || kind === 'walker') ? LANE_COLOR[lane] : MAP_SYMBOLS[kind].color
}
