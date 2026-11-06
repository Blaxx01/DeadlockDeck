/**
 * Hero-Meisterschaft: bis zu 5 Sterne je Hero.
 * Hero-Karte · alle 4 Fähigkeiten-Karten · Counter-Karte (je mind. Silber) ·
 * Build-Quiz (Typisch) ohne Fehler · Hero erraten einmal ohne Aufdecken, Joker und Fehltipp.
 */
import { buildBestKey, db, getBuildBests, getMeta, type BuildBest, type DeckDB, type ReviewRecord } from '../data/db'
import type { HeroCard } from '../data/model'
import { atLeast, masteryOf, type Mastery } from './mastery'

export type StarId = 'hero' | 'abilities' | 'counter' | 'build' | 'guess'

export const STAR_IDS: StarId[] = ['hero', 'abilities', 'counter', 'build', 'guess']

export const STAR_LABEL: Record<StarId, string> = {
  hero: 'Hero-Karte mind. Silber',
  abilities: 'Alle 4 Fähigkeiten-Karten mind. Silber',
  counter: 'Counter-Karte mind. Silber',
  build: 'Build-Quiz (Typisch) ohne Fehler',
  guess: 'Hero erraten ohne Aufdecken, Joker und Fehltipp',
}

export const MAX_STARS = STAR_IDS.length

export function counterCardId(hero: Pick<HeroCard, 'className'>): string {
  return `counter:${hero.className}`
}

export interface HeroMastery {
  hero: HeroCard
  stars: StarId[]
  heroLevel: Mastery
  /** Stufe je Fähigkeit (Karten-ID → Stufe) */
  abilityLevels: { id: string; name: string; image?: string; level: Mastery }[]
  counterLevel?: Mastery
  buildBest?: BuildBest
  guessClean: boolean
}

export interface HeroMasteryInput {
  reviews: ReadonlyMap<string, Pick<ReviewRecord, 'state' | 'scheduled_days'>>
  /** Gibt es eine Counter-Karte für den Hero? */
  counterIds: ReadonlySet<string>
  buildBests: Readonly<Record<string, BuildBest>>
  guessClean: ReadonlySet<string>
}

export function heroMastery(hero: HeroCard, input: HeroMasteryInput): HeroMastery {
  const level = (id: string) => masteryOf(input.reviews.get(id))
  const heroLevel = level(hero.id)
  const abilityLevels = hero.abilities.map(a => ({ id: a.id, name: a.name, image: a.image, level: level(a.id) }))
  const counterId = counterCardId(hero)
  const counterLevel = input.counterIds.has(counterId) ? level(counterId) : undefined
  const buildBest = input.buildBests[buildBestKey('typical', hero.heroId)]
  const guessClean = input.guessClean.has(hero.id)
  const stars: StarId[] = []
  if (atLeast(heroLevel, 'silver')) stars.push('hero')
  if (abilityLevels.length > 0 && abilityLevels.every(a => atLeast(a.level, 'silver'))) stars.push('abilities')
  if (counterLevel && atLeast(counterLevel, 'silver')) stars.push('counter')
  if (buildBest?.errors === 0) stars.push('build')
  if (guessClean) stars.push('guess')
  return { hero, stars, heroLevel, abilityLevels, counterLevel, buildBest, guessClean }
}

/** Alle Karten-IDs, die in die Sterne der Heroes eingehen (Hero, Fähigkeiten, Counter) */
export function heroCardIds(heroes: readonly HeroCard[]): string[] {
  return heroes.flatMap(h => [h.id, ...h.abilities.map(a => a.id), counterCardId(h)])
}

/** Eingaben für die Sterne der Heroes aus der Datenbank (nur lesen, auch in Transaktionen nutzbar) */
export async function loadHeroMasteryInput(heroes: readonly HeroCard[], database: DeckDB = db): Promise<HeroMasteryInput> {
  const [reviews, counters, buildBests, guessClean] = await Promise.all([
    database.reviews.bulkGet(heroCardIds(heroes)),
    database.counters.bulkGet(heroes.map(counterCardId)),
    getBuildBests(database),
    getMeta<string[]>('guessClean', [], database),
  ])
  return {
    reviews: new Map(reviews.filter(r => r !== undefined).map(r => [r.id, r])),
    counterIds: new Set(counters.filter(c => c !== undefined).map(c => c.id)),
    buildBests,
    guessClean: new Set(guessClean),
  }
}

/** Alle Heroes (alphabetisch) mit ihren Sternen */
export async function allHeroMastery(database: DeckDB = db): Promise<HeroMastery[]> {
  const heroes = (await database.heroes.toArray()).sort((a, b) => a.name.localeCompare(b.name))
  const input = await loadHeroMasteryInput(heroes, database)
  return heroes.map(h => heroMastery(h, input))
}
