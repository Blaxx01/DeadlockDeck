/**
 * Held des Tages (Lane-Angriff): drei Vorschläge – bevorzugt Heroes, die man noch kaum kennt –, die Wahl legt die
 * Hero-Mission fest: seine noch nicht gelernten Karten lernen, sonst Build-Quiz mit ihm (ab Akolyth 1), sonst seine
 * Karten wiederholen.
 */
import { State } from 'ts-fsrs'
import { db, type DeckDB, type ReviewRecord } from '../data/db'
import type { HeroCard } from '../data/model'
import { shuffle } from '../quiz/quiz'
import { allHeroMastery, counterCardId } from './heroMastery'
import { HERO_BUILD_ERRORS, TOP_LEVEL, type MissionLevel } from './missionLevels'
import { hashString, seededRng } from './random'

export type HeroMissionMode = 'learn' | 'build' | 'review'

export interface HeroPick {
  /** Hero-Karten-ID, z. B. hero:hero_haze */
  id: string
  name: string
  /** Numerische Hero-ID (Build-Quiz) */
  heroId: number
  image?: string
  mode: HeroMissionMode
  /** learn/review: die Karten, die zählen */
  cards: string[]
  /** build: höchstens so viele Fehler (je nach Stufe; fehlt bei Auslosungen von vor den Stufen: 2) */
  maxErrors?: number
}

export const HERO_OFFER_SIZE = 3
/** Aus so vielen der am wenigsten bekannten Heroes kommen zwei Vorschläge, der dritte aus allen übrigen */
const LEAST_KNOWN_POOL = 8

/** Karten eines Heroes: Hero-Karte, Fähigkeiten, Counter (wenn es seine Counter-Karte gibt) */
export function heroCards(hero: Pick<HeroCard, 'id' | 'className' | 'abilities'>, hasCounter: boolean): string[] {
  return [hero.id, ...hero.abilities.map(a => a.id), ...(hasCounter ? [counterCardId(hero)] : [])]
}

/** Noch nicht gelernt: nie bewertet (auch kennengelernt, aber noch nicht abgefragt) */
export function isUnlearned(review?: Pick<ReviewRecord, 'state'>): boolean {
  return !review || review.state === State.New
}

/** Vorschläge des Tages: zwei aus den am wenigsten bekannten, einer aus den übrigen – fest pro Tag und Stand */
export function heroOffer(date: string, heroes: readonly { id: string; known: number }[]): string[] {
  if (heroes.length <= HERO_OFFER_SIZE) return heroes.map(h => h.id)
  const rng = seededRng(hashString(`hero:${date}`))
  // erst mischen, dann stabil sortieren: bei Gleichstand fest ausgelost
  const ranked = shuffle(heroes, rng).sort((a, b) => a.known - b.known)
  const low = ranked.slice(0, Math.min(LEAST_KNOWN_POOL, ranked.length - 1))
  const picked = shuffle(low, rng).slice(0, HERO_OFFER_SIZE - 1)
  const rest = shuffle(ranked.filter(h => !picked.includes(h)), rng)
  return [...picked, rest[0]].map(h => h.id)
}

/** Wie gut ein Hero schon sitzt: Sterne zählen viel, gelernte Karten wenig */
export async function heroKnowledge(database: DeckDB = db): Promise<{ id: string; known: number }[]> {
  return (await allHeroMastery(database))
    .filter(m => m.hero.abilities.length > 0)
    .map(m => ({
      id: m.hero.id,
      known: m.stars.length * 10
        + [m.heroLevel, ...m.abilityLevels.map(a => a.level), m.counterLevel].filter(l => l !== undefined && l !== 'none').length,
    }))
}

/** Hero-Mission für diesen Helden – festgelegt bei der Wahl */
/** Mission für einen Helden – Build-Quiz erst ab der Stufe, die es freischaltet (Akolyth 1), davor wiederholen */
export async function makeHeroPick(heroCardId: string, database: DeckDB = db, level: MissionLevel = TOP_LEVEL): Promise<HeroPick | null> {
  const hero = await database.heroes.get(heroCardId)
  if (!hero) return null
  const hasCounter = (await database.counters.get(counterCardId(hero))) !== undefined
  const cards = heroCards(hero, hasCounter)
  const reviews = await database.reviews.bulkGet(cards)
  const unlearned = cards.filter((_, i) => isUnlearned(reviews[i]))
  const base = { id: hero.id, name: hero.name, heroId: hero.heroId, ...(hero.smallImage ?? hero.image ? { image: hero.smallImage ?? hero.image } : {}) }
  if (unlearned.length) return { ...base, mode: 'learn', cards: unlearned }
  const maxErrors = HERO_BUILD_ERRORS[level]
  const builds = maxErrors === null ? 0 : await database.builds.where('source').equals('typical').filter(b => b.heroId === hero.heroId).count()
  if (builds > 0 && maxErrors !== null) return { ...base, mode: 'build', cards: [], maxErrors }
  return { ...base, mode: 'review', cards }
}
