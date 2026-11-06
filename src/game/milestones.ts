/**
 * Meilenstein-Souls: Karte erstmals Silber +25, erstmals Gold +50, jeder neue Hero-Stern +100.
 * Jeder Meilenstein bringt nur einmal Souls – auch wenn eine Karte vergessen und später wieder gefestigt wird.
 * Gespeichert in meta: 'milestones' (Karte → höchste belohnte Stufe), 'heroStars' (Hero → belohnte Sterne),
 * 'guessClean' (Heroes, die einmal ohne Aufdecken, Joker und Fehltipp erraten wurden).
 */
import { localDate } from '../data/dates'
import { db, getMeta, setMeta, type DeckDB } from '../data/db'
import type { HeroCard } from '../data/model'
import { heroMastery, loadHeroMasteryInput, type StarId } from './heroMastery'
import { MASTERY_LABEL, MASTERY_MEDAL, masteryOf, type Mastery } from './mastery'
import { addSoulsInTx, announceGain, type SoulsGain } from './souls'

export const SILVER_SOULS = 25
export const GOLD_SOULS = 50
export const STAR_SOULS = 100

export type MilestoneLevel = 'silver' | 'gold'
/** Höchste Stufe je Karte, für die es schon Souls gab */
export type MilestoneMap = Record<string, MilestoneLevel>
/** Sterne je Hero (Hero-Karten-ID), für die es schon Souls gab */
export type StarMap = Record<string, StarId[]>

/** Souls für neu erreichte Stufen: Silber +25, Gold +50 (direkt Gold: beides) */
export function milestoneSouls(previous: MilestoneLevel | undefined, level: Mastery): number {
  let souls = 0
  if ((level === 'silver' || level === 'gold') && !previous) souls += SILVER_SOULS
  if (level === 'gold' && previous !== 'gold') souls += GOLD_SOULS
  return souls
}

/** Sterne, die es noch nicht gab */
export function newStars(awarded: readonly StarId[] | undefined, current: readonly StarId[]): StarId[] {
  return current.filter(s => !awarded?.includes(s))
}

/** Tabellen der Prüfung – für Transaktionen */
function tables(database: DeckDB) {
  return [database.reviews, database.heroes, database.abilities, database.counters, database.items, database.meta, database.souls]
}

/** Numerische Hero-IDs, zu denen die Karten gehören (Hero-, Fähigkeiten- und Counter-Karten) */
async function heroIdsOfCards(cardIds: readonly string[], database: DeckDB): Promise<number[]> {
  const of = (prefix: string) => cardIds.filter(id => id.startsWith(prefix))
  const [heroes, abilities, counters] = await Promise.all([
    database.heroes.bulkGet(of('hero:')),
    database.abilities.bulkGet(of('ability:')),
    database.counters.bulkGet(of('counter:')),
  ])
  return [...new Set([...heroes, ...abilities, ...counters].filter(c => c !== undefined).map(c => c.heroId))]
}

interface CheckOptions {
  /** Beim Start: alles in je einem Eintrag zusammenfassen, ohne Animation */
  retro?: boolean
}

/** Meilensteine der Karten und neue Sterne der Heroes gutschreiben – nur in einer Transaktion über `tables` */
async function awardInTx(
  database: DeckDB,
  cardIds: readonly string[],
  heroIds: readonly number[],
  now: Date,
  { retro = false }: CheckOptions = {},
): Promise<SoulsGain[]> {
  const date = localDate(now)
  const at = now.getTime()
  const gains: SoulsGain[] = []

  const milestones = { ...(await getMeta<MilestoneMap>('milestones', {}, database)) }
  const reviews = await database.reviews.bulkGet([...cardIds])
  let cardSouls = 0
  let cardCount = 0
  for (const [i, id] of cardIds.entries()) {
    const level = masteryOf(reviews[i])
    const amount = milestoneSouls(milestones[id], level)
    if (amount === 0) continue
    const reached: MilestoneLevel = level === 'gold' ? 'gold' : 'silver'
    milestones[id] = reached
    cardSouls += amount
    cardCount++
    if (!retro) {
      const gain = await addSoulsInTx(database, { at, date, amount, reason: 'milestone', data: { card: id, level: reached } })
      gains.push({ ...gain, label: `${MASTERY_MEDAL[reached]} ${MASTERY_LABEL[reached]}` })
    }
  }
  if (cardCount > 0) await setMeta('milestones', milestones, database)
  if (retro && cardSouls > 0) {
    gains.push(await addSoulsInTx(database, { at, date, amount: cardSouls, reason: 'milestone', data: { retro: true, count: cardCount } }))
  }

  if (heroIds.length > 0) {
    const wanted = new Set(heroIds)
    const heroes: HeroCard[] = (await database.heroes.toArray()).filter(h => wanted.has(h.heroId))
    const input = await loadHeroMasteryInput(heroes, database)
    const stars = { ...(await getMeta<StarMap>('heroStars', {}, database)) }
    let starCount = 0
    for (const hero of heroes) {
      const current = heroMastery(hero, input).stars
      const fresh = newStars(stars[hero.id], current)
      if (fresh.length === 0) continue
      stars[hero.id] = [...(stars[hero.id] ?? []), ...fresh]
      starCount += fresh.length
      if (!retro) {
        for (const star of fresh) {
          const gain = await addSoulsInTx(database, { at, date, amount: STAR_SOULS, reason: 'star', data: { hero: hero.id, star } })
          gains.push({ ...gain, label: `★ ${hero.name}` })
        }
      }
    }
    if (starCount > 0) await setMeta('heroStars', stars, database)
    if (retro && starCount > 0) {
      gains.push(await addSoulsInTx(database, { at, date, amount: starCount * STAR_SOULS, reason: 'star', data: { retro: true, count: starCount } }))
    }
  }
  return gains
}

function announce(gains: readonly SoulsGain[]): SoulsGain[] {
  for (const gain of gains) announceGain(gain)
  return [...gains]
}

/** Nach einer Bewertung: Meilensteine der Karten und Sterne ihrer Heroes */
export async function checkCardMilestones(cardIds: readonly string[], now = new Date(), database: DeckDB = db): Promise<SoulsGain[]> {
  const gains = await database.transaction('rw', tables(database), async () =>
    awardInTx(database, cardIds, await heroIdsOfCards(cardIds, database), now))
  return announce(gains)
}

/** Nach dem Build-Quiz: Sterne der Heroes (numerische Hero-IDs) */
export async function checkHeroStars(heroIds: readonly number[], now = new Date(), database: DeckDB = db): Promise<SoulsGain[]> {
  // async-Funktion als Rahmen: nur dann hält Dexie die Transaktion über native awaits hinweg
  const gains = await database.transaction('rw', tables(database), async () => awardInTx(database, [], heroIds, now))
  return announce(gains)
}

/** Hero erraten ohne Aufdecken, Joker und Fehltipp: merken und den Stern prüfen */
export async function markGuessClean(heroCardId: string, now = new Date(), database: DeckDB = db): Promise<SoulsGain[]> {
  const gains = await database.transaction('rw', tables(database), async () => {
    const clean = await getMeta<string[]>('guessClean', [], database)
    if (!clean.includes(heroCardId)) await setMeta('guessClean', [...clean, heroCardId], database)
    return awardInTx(database, [], await heroIdsOfCards([heroCardId], database), now)
  })
  return announce(gains)
}

/**
 * Beim Start: alle Meilensteine prüfen und fehlende still gutschreiben (je ein Eintrag für Karten und Sterne) –
 * beim ersten Start mit Meilensteinen der bisherige Fortschritt, sonst z. B. nach dem Einspielen eines Backups.
 * Gibt die gutgeschriebenen Souls zurück.
 */
export async function checkAllMilestones(now = new Date(), database: DeckDB = db): Promise<number> {
  const gains = await database.transaction('rw', tables(database), async () => {
    const keys = await Promise.all([database.items, database.abilities, database.heroes, database.counters].map(t => t.toCollection().primaryKeys()))
    const cardIds = keys.flat() as string[]
    const heroIds = (await database.heroes.toArray()).map(h => h.heroId)
    return awardInTx(database, cardIds, heroIds, now, { retro: true })
  })
  return gains.reduce((sum, g) => sum + g.amount, 0)
}

/** Alle Meilensteine vergessen (Fortschritt löschen, Backup einspielen) – in einer Transaktion über meta */
export async function resetMilestonesInTx(database: DeckDB, restore: { milestones?: MilestoneMap; heroStars?: StarMap; guessClean?: string[] } = {}): Promise<void> {
  await setMeta('milestones', restore.milestones ?? {}, database)
  await setMeta('heroStars', restore.heroStars ?? {}, database)
  await setMeta('guessClean', restore.guessClean ?? [], database)
}

export async function getMilestones(database: DeckDB = db): Promise<{ milestones: MilestoneMap; heroStars: StarMap; guessClean: string[] }> {
  const [milestones, heroStars, guessClean] = await Promise.all([
    getMeta<MilestoneMap>('milestones', {}, database),
    getMeta<StarMap>('heroStars', {}, database),
    getMeta<string[]>('guessClean', [], database),
  ])
  return { milestones, heroStars, guessClean }
}
