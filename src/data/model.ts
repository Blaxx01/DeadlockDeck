import type { SlotType } from './apiTypes'

export type { SlotType }

export interface Stat {
  label: string
  value: string
  negative?: boolean
  conditional?: boolean
}

export type SectionType = 'innate' | 'active' | 'passive'

export interface CardSection {
  type: SectionType
  /** HTML aus der API (vor der Anzeige sanitisieren!) */
  html?: string
  stats: Stat[]
}

export interface ItemCard {
  /** Stabile Karten-ID, z. B. "item:upgrade_headshot_booster" */
  id: string
  className: string
  /** Englischer Name (wie ingame) */
  name: string
  slot: SlotType
  tier: number
  cost: number
  isActive: boolean
  image?: string
  /** Cooldown, Dauer, Reichweite */
  timings: Stat[]
  sections: CardSection[]
  /** Englische Namen der Komponenten */
  buildsFrom: string[]
  /** Englische Namen der Items, in die dieses Item upgradet */
  upgradesTo: string[]
  /** Hash des Inhalts, um Patch-Änderungen zu erkennen */
  hash: string
}

export const SLOT_LABEL: Record<SlotType, string> = {
  weapon: 'Weapon',
  vitality: 'Vitality',
  spirit: 'Spirit',
}

export const SECTION_LABEL: Record<SectionType, string> = {
  innate: 'Boni',
  passive: 'Passiv',
  active: 'Aktiv',
}
