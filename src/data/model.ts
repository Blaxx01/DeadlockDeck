import type { SlotType } from './apiTypes'

export type { SlotType }

export interface Stat {
  label: string
  value: string
  negative?: boolean
  conditional?: boolean
}

export type TimingKind = 'cooldown' | 'duration' | 'range' | 'charges'

export interface Timing extends Stat {
  kind: TimingKind
}

export type SectionType = 'innate' | 'active' | 'passive'

export interface CardSection {
  type: SectionType
  /** HTML aus der API (vor der Anzeige sanitisieren!) */
  html?: string
  stats: Stat[]
}

/** Ein Wert der Broker-Variante: normal → corrupted */
export interface CorruptedStat {
  label: string
  base: string
  value: string
  /** schwankt pro Match um ±CORRUPTED_VARIANCE_PERCENT */
  varies: boolean
}

export interface CorruptedInfo {
  /** Preis der Corrupted-Variante (falls bekannt) */
  price?: number
  bonuses: CorruptedStat[]
  /** Mögliche Nachteile – einer davon wird pro Kauf zufällig gewürfelt */
  penalties: Stat[]
}

/** Standard-Schwankung der Broker-Werte je Match (Spiel-Convars, Stand der API-Bibliothek) */
export const CORRUPTED_VARIANCE_PERCENT = 15

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
  timings: Timing[]
  sections: CardSection[]
  /** Englische Namen der Komponenten */
  buildsFrom: string[]
  /** Englische Namen der Items, in die dieses Item upgradet */
  upgradesTo: string[]
  /** Broker-Variante (nur Tier 3/4) */
  corrupted?: CorruptedInfo
  /** Fingerprint der Spielwerte – erkennt Patches (siehe fingerprint.ts) */
  fingerprint: string
}

export const SLOT_LABEL: Record<SlotType, string> = {
  weapon: 'Weapon',
  vitality: 'Vitality',
  spirit: 'Spirit',
}

export type QuizKind = 'image' | 'description' | 'number' | 'build'

export const QUIZ_KINDS: QuizKind[] = ['image', 'description', 'number', 'build']

export const QUIZ_KIND_LABEL: Record<QuizKind, string> = {
  image: 'Bild → Name',
  description: 'Beschreibung → Item',
  number: 'Zahlen',
  build: 'Build-Pfad',
}

export const SECTION_LABEL: Record<SectionType, string> = {
  innate: 'Boni',
  passive: 'Passiv',
  active: 'Aktiv',
}

/** Ability-Slot: 1–3 normale Fähigkeiten, 4 = Ultimate */
export function abilitySlotLabel(slot: number): string {
  return slot === 4 ? 'Ultimate' : `Fähigkeit ${slot}`
}

export interface AbilityRef {
  id: string
  name: string
  image?: string
  slot: number
}

export interface HeroCard {
  /** z. B. "hero:hero_haze" */
  id: string
  heroId: number
  className: string
  /** Englischer Name */
  name: string
  /** Reihenfolge neuer Karten (alphabetisch) */
  order: number
  image?: string
  smallImage?: string
  /** Freigestellte Kartenbilder in mehreren Posen (normal, critical, gloat) – fürs Hero-Erraten */
  poses: string[]
  /** Akzentfarbe des Heroes (#RRGGBB) */
  color?: string
  /** Deutsch: Kurzbeschreibung der Rolle */
  role?: string
  /** Deutsch: Spielstil (HTML) */
  playstyle?: string
  /** Deutsche Tags, z. B. Assassine, Schattenhaft */
  tags: string[]
  /** Deutsch: Waffentyp, z. B. Schnellfeuer */
  gunTag?: string
  /** 1–4 */
  complexity?: number
  stats: Stat[]
  weapon?: { name: string; stats: Stat[] }
  abilities: AbilityRef[]
  /** Fingerprint der Spielwerte – erkennt Patches (siehe fingerprint.ts) */
  fingerprint: string
}

export interface AbilityUpgrade {
  /** Kosten in Ability-Punkten (1, 2, 5) */
  cost: number
  /** Deutsch (HTML) */
  html: string
}

export interface AbilityCard {
  /** z. B. "ability:ability_sleep_dagger" */
  id: string
  className: string
  /** Englischer Name */
  name: string
  heroId: number
  heroName: string
  heroImage?: string
  heroColor?: string
  slot: number
  order: number
  image?: string
  /** Deutsch: Kurzsatz, z. B. „Lässt einen Gegner einschlafen“ */
  quip?: string
  /** Deutsch: Effekttext (HTML) */
  html?: string
  timings: Timing[]
  stats: Stat[]
  upgrades: AbilityUpgrade[]
  /** Fingerprint der Spielwerte – erkennt Patches (siehe fingerprint.ts) */
  fingerprint: string
}

/** Varianten beim Hero-Erraten */
export type GuessKind = 'silhouette' | 'zoom' | 'blur' | 'ability'

export const GUESS_KINDS: GuessKind[] = ['silhouette', 'zoom', 'blur', 'ability']

export const GUESS_KIND_LABEL: Record<GuessKind, string> = {
  silhouette: 'Silhouette',
  zoom: 'Zoom-Ausschnitt',
  blur: 'Unscharf → scharf',
  ability: 'Fähigkeit → Hero',
}
