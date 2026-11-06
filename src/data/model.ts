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
  /** Numerische ID der API (Statistiken wie die Counter-Daten verwenden sie) */
  apiId: number
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

export type QuizKind = 'image' | 'description' | 'number' | 'build' | 'counterItem' | 'counterHero' | 'upgrade' | 'effect'

export const QUIZ_KINDS: QuizKind[] = ['image', 'description', 'number', 'build', 'counterItem', 'counterHero', 'upgrade', 'effect']

/** Fragetypen, die es schon vor den Counter-Fragen gab (für gespeicherte Einstellungen ohne `knownQuizKinds`) */
export const LEGACY_QUIZ_KINDS: QuizKind[] = ['image', 'description', 'number', 'build']

export const QUIZ_KIND_LABEL: Record<QuizKind, string> = {
  image: 'Bild → Name',
  description: 'Beschreibung → Item',
  number: 'Zahlen',
  build: 'Build-Pfad',
  counterItem: 'Counter: Hero → Item',
  counterHero: 'Counter: Item → Hero',
  upgrade: 'Fähigkeiten-Upgrades',
  effect: 'Item-Effekte',
}

/** Ein Counter-Item gegen einen Hero */
export interface CounterItem {
  /** Item-Karten-ID, z. B. "item:upgrade_metal_skin" */
  itemId: string
  /** Kauf-Faktor: wird gegen den Hero so viel öfter gekauft als sonst (2.1 = 2,1×) */
  factor: number
}

/** Counter-Karte: welche Items Spieler (ab Orakel) gegen einen Hero besonders oft kaufen */
export interface CounterCard {
  /** z. B. "counter:hero_haze" */
  id: string
  /** Numerische Hero-ID der API */
  heroId: number
  heroName: string
  image?: string
  smallImage?: string
  color?: string
  /** Reihenfolge neuer Karten: klarste Counter (höchster Faktor des Top-Items) zuerst */
  order: number
  /** Die 3 Items mit dem höchsten Kauf-Faktor */
  top: CounterItem[]
  /** Kauf-Faktor aller Items mit genug Daten (Item-Karten-ID → Faktor) – fürs Quiz */
  factors: Record<string, number>
  /** Datenstand (Zeitpunkt der Abfrage) */
  updatedAt: number
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

/** Build-Quiz: typischer Build (Kaufdaten) oder meistgespielter Community-Build */
export type BuildSource = 'typical' | 'community'

export const BUILD_SOURCES: BuildSource[] = ['typical', 'community']

export const BUILD_SOURCE_LABEL: Record<BuildSource, string> = {
  typical: 'Typisch',
  community: 'Community',
}

export interface BuildItem {
  /** Item-Karten-ID */
  itemId: string
  /** Typisch: Anteil der Matches, in denen das Item auf dem Hero gekauft wird (0–1) */
  pick?: number
  /** Typisch: ⌀ Kaufzeit in Sekunden */
  buyTime?: number
}

export interface BuildSection {
  title: string
  items: BuildItem[]
}

/** Ein Build fürs Build-Quiz */
export interface BuildRecord {
  /** z. B. "typical:hero_haze" oder "community:hero_haze" */
  id: string
  source: BuildSource
  heroId: number
  heroName: string
  image?: string
  smallImage?: string
  color?: string
  sections: BuildSection[]
  /** Community: Name des Builds (vom Autor, beliebiger Text) */
  buildName?: string
  buildId?: number
  /** Community: Anteil an den ausgewerteten Matches des Heroes (0–1) */
  share?: number
  /** Community: letzte Änderung des Builds (ms) */
  lastUpdated?: number
  /** Datenstand (Zeitpunkt der Abfrage) */
  updatedAt: number
}
