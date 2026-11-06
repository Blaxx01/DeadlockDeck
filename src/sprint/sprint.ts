/**
 * 60-Sekunden-Sprint: Items, Fähigkeiten und Heroes am Bild erkennen (4 Antworten).
 * Falsch kostet 3 Sekunden; Highscore je Auswahl.
 */
import { LEARNED_ONLY_MIN, type AbilityCard, type HeroCard, type ItemCard, type QuizScope, type SlotType } from '../data/model'
import { makeOptions, pickSimilar, shuffle, type Rng } from '../quiz/quiz'

export const SPRINT_MS = 60_000
export const WRONG_PENALTY_MS = 3_000
/** Souls je richtige Antwort (wie ein Item im Build-Quiz) */
export const SPRINT_SOULS_PER_CORRECT = 5

export type SprintPool = 'all' | 'items' | 'abilities' | 'heroes'
export const SPRINT_POOLS: SprintPool[] = ['all', 'items', 'abilities', 'heroes']
export const SPRINT_POOL_LABEL: Record<SprintPool, string> = {
  all: 'Alle',
  items: 'Items',
  abilities: 'Fähigkeiten',
  heroes: 'Heroes',
}

export type SprintKind = 'item' | 'ability' | 'hero'
const KINDS_OF: Record<SprintPool, SprintKind[]> = {
  all: ['item', 'ability', 'hero'],
  items: ['item'],
  abilities: ['ability'],
  heroes: ['hero'],
}
export const SPRINT_KIND_LABEL: Record<SprintKind, string> = { item: 'Item', ability: 'Fähigkeit', hero: 'Hero' }

export interface SprintQuestion {
  kind: SprintKind
  /** Karte, um die es geht (Fehlerliste, Schwächen) */
  cardId: string
  image: string
  /** Item: Kategorie für die Kachelfarbe */
  slot?: SlotType
  options: string[]
  /** Index der richtigen Antwort */
  answer: number
  /** Fähigkeit: zu welchem Hero sie gehört (Auflösung) */
  detail?: string
  /** „Gelerntes zuerst“: Karte noch nicht gelernt (als „Neu“ markiert, ein Fehler zählt nicht als Schwäche) */
  unlearned?: boolean
}

export interface SprintCards {
  items: readonly ItemCard[]
  abilities: readonly AbilityCard[]
  heroes: readonly HeroCard[]
  /** Gelernte Karten (im Lernmodus mindestens einmal bewertet) */
  known?: ReadonlySet<string>
  /** Gelernte zuerst, nur gelernte oder alle (Standard: alle) */
  scope?: QuizScope
}

type Card = ItemCard | AbilityCard | HeroCard

function heroImages(hero: HeroCard): string[] {
  return hero.poses?.length ? hero.poses : hero.image ? [hero.image] : []
}

/** Karten einer Sorte, die ein Bild haben */
function usable(cards: SprintCards, kind: SprintKind): Card[] {
  if (kind === 'item') return cards.items.filter(i => i.image)
  if (kind === 'ability') return cards.abilities.filter(a => a.image)
  return cards.heroes.filter(h => heroImages(h).length > 0)
}

/** Sorten einer Auswahl */
export function poolKinds(pool: SprintPool): SprintKind[] {
  return KINDS_OF[pool]
}

/** Gelernte Karten einer Sorte (mit Bild) */
export function learnedCount(cards: SprintCards, kind: SprintKind): number {
  return usable(cards, kind).filter(c => cards.known?.has(c.id)).length
}

/**
 * Sorten der Auswahl, für die es genug Karten gibt (mind. 4 – für 3 falsche Antworten);
 * bei „Nur Gelerntes“ außerdem mind. LEARNED_ONLY_MIN gelernte
 */
export function sprintKinds(cards: SprintCards, pool: SprintPool): SprintKind[] {
  return KINDS_OF[pool].filter(kind => usable(cards, kind).length >= 4
    && (cards.scope !== 'learned-only' || learnedCount(cards, kind) >= LEARNED_ONLY_MIN))
}

function itemQuestion(item: ItemCard, cards: SprintCards, rng: Rng): SprintQuestion | null {
  const opts = makeOptions(item.name, pickSimilar(item, usable(cards, 'item') as ItemCard[], 3, rng).map(c => c.name), rng)
  if (!opts || !item.image) return null
  return { kind: 'item', cardId: item.id, image: item.image, slot: item.slot, ...opts }
}

function abilityQuestion(ability: AbilityCard, cards: SprintCards, rng: Rng): SprintQuestion | null {
  // Falsche Antworten: andere Fähigkeiten, bevorzugt gleiche Art (Ultimate oder nicht)
  const isUlt = (a: AbilityCard) => a.slot === 4
  const others = (usable(cards, 'ability') as AbilityCard[])
    .filter(a => a.name !== ability.name)
    .map(a => ({ a, d: (isUlt(a) === isUlt(ability) ? 0 : 1) + rng() * 1.5 }))
    .sort((x, y) => x.d - y.d)
    .map(x => x.a.name)
  const opts = makeOptions(ability.name, others, rng)
  if (!opts || !ability.image) return null
  return { kind: 'ability', cardId: ability.id, image: ability.image, detail: `Fähigkeit von ${ability.heroName}`, ...opts }
}

function heroQuestion(hero: HeroCard, cards: SprintCards, rng: Rng): SprintQuestion | null {
  const images = heroImages(hero)
  const others = shuffle(usable(cards, 'hero').filter(h => h.name !== hero.name), rng).map(h => h.name)
  const opts = makeOptions(hero.name, others, rng)
  if (!opts || images.length === 0) return null
  return { kind: 'hero', cardId: hero.id, image: images[Math.floor(rng() * images.length)], ...opts }
}

export function makeSprintQuestion(kind: SprintKind, card: Card, cards: SprintCards, rng: Rng = Math.random): SprintQuestion | null {
  if (kind === 'item') return itemQuestion(card as ItemCard, cards, rng)
  if (kind === 'ability') return abilityQuestion(card as AbilityCard, cards, rng)
  return heroQuestion(card as HeroCard, cards, rng)
}

/**
 * Nächste Frage: Sorte gleich verteilt (bei „Alle“), Karte zufällig – jede Karte erst wieder,
 * wenn alle ihrer Sorte dran waren. `used` merkt sich die gefragten Karten (wird hier ergänzt).
 * „Gelerntes zuerst“: erst die gelernten Karten, dann die anderen (markiert); „Nur Gelerntes“: nur gelernte.
 * Die falschen Antworten kommen immer aus allen Karten der Sorte.
 */
export function nextSprintQuestion(cards: SprintCards, pool: SprintPool, used: Set<string>, rng: Rng = Math.random): SprintQuestion | null {
  const kinds = sprintKinds(cards, pool)
  const scope = cards.scope ?? 'all'
  const isKnown = (c: Card) => cards.known?.has(c.id) ?? false
  for (const kind of shuffle(kinds, rng)) {
    const all = usable(cards, kind)
    const list = scope === 'learned-only' ? all.filter(isKnown) : all
    let fresh = list.filter(c => !used.has(c.id))
    if (fresh.length === 0) {
      for (const c of list) used.delete(c.id)
      fresh = list
    }
    const mixed = shuffle(fresh, rng)
    const order = scope === 'learned-first' ? [...mixed.filter(isKnown), ...mixed.filter(c => !isKnown(c))] : mixed
    for (const card of order) {
      const question = makeSprintQuestion(kind, card, cards, rng)
      if (question) {
        used.add(card.id)
        return scope === 'learned-first' && !isKnown(card) ? { ...question, unlearned: true } : question
      }
    }
  }
  return null
}

export interface SprintAnswer {
  question: SprintQuestion
  picked: number
}

/** Verbleibende Zeit: 60 s ab Start, −3 s je Fehler, Pausen (App im Hintergrund) zählen nicht */
export function sprintTimeLeft(startedAt: number, now: number, wrong: number, pausedMs = 0): number {
  return Math.max(0, SPRINT_MS - WRONG_PENALTY_MS * wrong - (now - startedAt - pausedMs))
}

/** Uhr einer Runde – reine Funktion für useReducer; im Hintergrund steht sie */
export interface SprintClock {
  startedAt: number
  now: number
  pausedMs: number
  hiddenAt: number | null
}

export type ClockAction = { type: 'tick' | 'hide' | 'show'; now: number }

export function startClock(now: number): SprintClock {
  return { startedAt: now, now, pausedMs: 0, hiddenAt: null }
}

export function clockReducer(clock: SprintClock, action: ClockAction): SprintClock {
  if (action.type === 'hide') return clock.hiddenAt === null ? { ...clock, hiddenAt: action.now, now: action.now } : clock
  if (action.type === 'show') {
    if (clock.hiddenAt === null) return clock
    return { ...clock, pausedMs: clock.pausedMs + (action.now - clock.hiddenAt), hiddenAt: null, now: action.now }
  }
  return { ...clock, now: action.now }
}

/** Verbleibende Zeit (im Hintergrund eingefroren) */
export function clockLeft(clock: SprintClock, wrong: number): number {
  return sprintTimeLeft(clock.startedAt, clock.hiddenAt ?? clock.now, wrong, clock.pausedMs)
}

/** Highscore-Schlüssel je Auswahl */
export type SprintHighscores = Partial<Record<SprintPool, number>>
