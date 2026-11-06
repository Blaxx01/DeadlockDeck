/**
 * Tagesmissionen: jeden Tag 3 Aufgaben (eine Lern-, zwei Spiel-Missionen), fest pro Tag ausgelost.
 * Je +100 Souls, alle drei +150 Bonus. Dazu der Tagesziel-Bonus (+100).
 */
import { localDate } from '../data/dates'
import { db, getMeta, getSettings, setMeta, type DayRecord, type DeckDB } from '../data/db'
import { LEARNED_ONLY_MIN } from '../data/model'
import { isReverseId, type DeckId } from '../decks'
import { loadLearnedCards } from '../quiz/load'
import { shuffle } from '../quiz/quiz'
import { laneState, trackLane, type LaneState } from './laneAttack'
import { hashString, seededRng } from './random'
import { addSoulsInTx, announceGain, awardRound, GOAL_SOULS, type RoundAward, type RoundMode, type SoulsEntry, type SoulsGain } from './souls'
import { weakCardCount } from './weakness'

export const MISSION_SOULS = 100
export const ALL_MISSIONS_BONUS = 150
export const MISSIONS_PER_DAY = 3

export interface MissionContext {
  day?: DayRecord
  /** Souls-Einträge von heute (Runden mit Ergebnis, Belohnungen) */
  entries: readonly SoulsEntry[]
  deckSizes: Partial<Record<DeckId, number>>
  heroCount: number
  buildCount: number
  /** Karten mit Fehlern in den letzten 14 Tagen (Schwächen-Training) */
  weakCount: number
  /** Einstellung „Nur Gelerntes“: gelernte Karten je Sorte (sonst fehlt das – dann zählt es nicht) */
  learnedOnly?: LearnedCounts
  /** Map-Daten vorhanden (Map-Quiz) */
  mapReady?: boolean
}

export interface LearnedCounts {
  items: number
  abilities: number
  heroes: number
}


export interface MissionDef {
  id: string
  kind: 'learn' | 'play'
  /** Pro Tag höchstens eine Mission je Gruppe */
  group: string
  title: string
  target: number
  available: (ctx: MissionContext) => boolean
  progress: (ctx: MissionContext) => number
}

const cardsOf = (ctx: MissionContext, prefix: string) => (ctx.day?.cards ?? []).filter(id => id.startsWith(prefix)).length
const bestOf = (ctx: MissionContext, reason: SoulsEntry['reason'], key: string) =>
  Math.max(0, ...ctx.entries.filter(e => e.reason === reason).map(e => Number(e.data?.[key] ?? 0)))
const deck = (ctx: MissionContext, id: DeckId) => ctx.deckSizes[id] ?? 0
/** Bei „Nur Gelerntes“: genug gelernte Karten einer dieser Sorten für eine volle Runde (Quiz und Hero erraten haben 10 Fragen) */
const learned = (ctx: MissionContext, ...kinds: (keyof LearnedCounts)[]) =>
  !ctx.learnedOnly || kinds.some(k => ctx.learnedOnly![k] >= LEARNED_ONLY_MIN)

export const MISSIONS: readonly MissionDef[] = [
  { id: 'learn-items', kind: 'learn', group: 'learn', title: '10 Item-Karten lernen', target: 10,
    available: c => deck(c, 'items') >= 10, progress: c => cardsOf(c, 'item:') },
  { id: 'learn-abilities', kind: 'learn', group: 'learn', title: '10 Fähigkeiten-Karten lernen', target: 10,
    available: c => deck(c, 'abilities') >= 10, progress: c => cardsOf(c, 'ability:') },
  { id: 'learn-heroes', kind: 'learn', group: 'learn', title: '5 Hero-Karten lernen', target: 5,
    available: c => deck(c, 'heroes') >= 5, progress: c => cardsOf(c, 'hero:') },
  { id: 'learn-counters', kind: 'learn', group: 'learn', title: '5 Counter-Karten lernen', target: 5,
    available: c => deck(c, 'counters') >= 5, progress: c => cardsOf(c, 'counter:') },
  { id: 'learn-new', kind: 'learn', group: 'learn', title: '5 neue Karten lernen', target: 5,
    available: c => deck(c, 'items') + deck(c, 'abilities') >= 5, progress: c => c.day?.newIntroduced ?? 0 },
  { id: 'learn-weak', kind: 'learn', group: 'learn', title: '5 Schwächen-Karten üben', target: 5,
    available: c => c.weakCount >= 5, progress: c => c.day?.weak?.length ?? 0 },
  { id: 'quiz-7', kind: 'play', group: 'quiz', title: 'Quiz mit mindestens 7 richtigen Antworten', target: 7,
    available: c => deck(c, 'items') >= 4 && learned(c, 'items'), progress: c => bestOf(c, 'quiz', 'correct') },
  { id: 'quiz-1000', kind: 'play', group: 'quiz', title: 'Quiz-Runde mit mindestens 1.000 Punkten', target: 1000,
    available: c => deck(c, 'items') >= 4 && learned(c, 'items'), progress: c => bestOf(c, 'quiz', 'score') },
  { id: 'guess-600', kind: 'play', group: 'guess', title: 'Hero erraten mit mindestens 600 Punkten', target: 600,
    available: c => c.heroCount >= 4 && learned(c, 'heroes'), progress: c => bestOf(c, 'guess', 'score') },
  { id: 'build-clean', kind: 'play', group: 'build', title: 'Build-Quiz ohne Fehler', target: 1,
    available: c => c.buildCount > 0, progress: c => (c.entries.some(e => e.reason === 'build' && e.data?.errors === 0) ? 1 : 0) },
  { id: 'sprint-15', kind: 'play', group: 'sprint', title: '60-Sekunden-Sprint mit mindestens 15 richtigen', target: 15,
    available: c => deck(c, 'items') >= 4 && learned(c, 'items', 'abilities', 'heroes'), progress: c => bestOf(c, 'sprint', 'score') },
  { id: 'map-7', kind: 'play', group: 'map', title: 'Map-Quiz mit mindestens 7 richtigen Antworten', target: 7,
    available: c => !!c.mapReady, progress: c => bestOf(c, 'map', 'correct') },
  { id: 'survival-10', kind: 'play', group: 'survival', title: 'Überleben: mindestens 10 Fragen', target: 10,
    available: c => deck(c, 'items') >= 4 && learned(c, 'items'), progress: c => bestOf(c, 'survival', 'score') },
]

const byId = new Map(MISSIONS.map(m => [m.id, m]))

export function missionById(id: string): MissionDef | undefined {
  return byId.get(id)
}

/** Eine Lern- und zwei Spiel-Missionen aus verschiedenen Gruppen; fehlt etwas, wird aufgefüllt */
export function pickMissions(date: string, available: readonly MissionDef[]): string[] {
  const rng = seededRng(hashString(date))
  const learn = shuffle(available.filter(m => m.kind === 'learn'), rng)
  const play = shuffle(available.filter(m => m.kind === 'play'), rng)
  const picked: MissionDef[] = []
  const groups = new Set<string>()
  const take = (list: readonly MissionDef[]) => {
    const m = list.find(x => !groups.has(x.group) && !picked.includes(x))
    if (m) {
      picked.push(m)
      groups.add(m.group)
    }
  }
  take(learn)
  take(play)
  take(play)
  // zu wenige Spiel-Modi (z. B. noch keine Hero-Daten): mit weiteren Missionen auffüllen
  for (const m of [...play, ...learn]) {
    if (picked.length >= MISSIONS_PER_DAY) break
    if (!picked.includes(m)) picked.push(m)
  }
  return picked.slice(0, MISSIONS_PER_DAY).map(m => m.id)
}

/**
 * Gelernte Karten je Sorte – nur bei „Nur Gelerntes“ (dann können Runden zu kurz für eine Mission sein).
 * Liest die Lernstände: nur fürs Auslosen, nicht in den Transaktionen von missionContext.
 */
export async function learnedOnlyCounts(database: DeckDB = db): Promise<LearnedCounts | undefined> {
  if ((await getSettings(database)).quizScope !== 'learned-only') return undefined
  const ids = [...(await loadLearnedCards(database))]
  const count = (prefix: string) => ids.filter(id => id.startsWith(prefix) && !isReverseId(id)).length
  return { items: count('item:'), abilities: count('ability:'), heroes: count('hero:') }
}

export async function missionContext(now: Date, database: DeckDB = db): Promise<MissionContext> {
  const date = localDate(now)
  const [day, entries, items, abilities, heroes, counters, builds, weakCount, map] = await Promise.all([
    database.days.get(date),
    database.souls.where('date').equals(date).toArray(),
    database.items.count(),
    database.abilities.count(),
    database.heroes.count(),
    database.counters.count(),
    database.builds.where('source').equals('typical').count(),
    weakCardCount(now, database),
    database.meta.get('mapData'),
  ])
  return {
    day, entries, deckSizes: { items, abilities, heroes, counters }, heroCount: heroes, buildCount: builds, weakCount,
    mapReady: map !== undefined && map.value !== null,
  }
}

interface StoredMissions {
  date: string
  ids: string[]
}

/** Missionen von heute (gespeichert bzw. frisch ausgelost). `store`: neue Auslosung festhalten */
export async function todayMissionIds(now: Date, database: DeckDB = db, store = false): Promise<string[]> {
  const date = localDate(now)
  const stored = await getMeta<StoredMissions | null>('missions', null, database)
  if (stored?.date === date) return stored.ids
  // „Nur Gelerntes“: Spiel-Missionen nur, wenn die Runden dafür lang genug sind
  const ctx: MissionContext = { ...(await missionContext(now, database)), learnedOnly: await learnedOnlyCounts(database) }
  const ids = pickMissions(date, MISSIONS.filter(m => m.available(ctx)))
  // Erst festhalten, wenn es genug gibt (z. B. noch keine Daten beim allerersten Start)
  if (store && ids.length === MISSIONS_PER_DAY) await setMeta('missions', { date, ids }, database)
  return ids
}

export interface MissionStatus {
  def: MissionDef
  progress: number
  done: boolean
  /** Reihenfolge des Schaffens (ID des Souls-Eintrags der Belohnung) – für den Lane-Angriff */
  doneSeq?: number
}

export interface DailyStatus {
  missions: MissionStatus[]
  /** Alle drei geschafft → Bonus gutgeschrieben */
  bonus: boolean
  goalReached: boolean
  /** Lane-Angriff des Tages (nur mit drei Missionen) */
  lane: LaneState | null
}

/** Stand einer Mission – geschafft, sobald belohnt oder das Ziel erreicht ist */
function missionStatus(def: MissionDef, ctx: MissionContext): MissionStatus {
  const progress = def.progress(ctx)
  const reward = ctx.entries.find(e => e.reason === 'mission' && e.data?.id === def.id)
  return { def, progress: Math.min(progress, def.target), done: !!reward || progress >= def.target, doneSeq: reward?.id }
}

/** Nur lesen (für die Startseite) */
export async function dailyStatus(now = new Date(), database: DeckDB = db): Promise<DailyStatus> {
  const ids = await todayMissionIds(now, database)
  const ctx = await missionContext(now, database)
  const missions = ids
    .map(id => byId.get(id))
    .filter((m): m is MissionDef => !!m)
    .map(def => missionStatus(def, ctx))
  return {
    missions,
    bonus: ctx.entries.some(e => e.reason === 'missions'),
    goalReached: ctx.entries.some(e => e.reason === 'goal'),
    lane: laneState(localDate(now), missions),
  }
}

/** Tagesziel-Bonus und geschaffte Missionen gutschreiben (jeweils einmal pro Tag) */
export async function checkDailyBonuses(now = new Date(), database: DeckDB = db): Promise<SoulsGain[]> {
  const date = localDate(now)
  const ids = await todayMissionIds(now, database, true)
  const settings = await getSettings(database)
  const tables = [database.souls, database.meta, database.days, database.items, database.abilities, database.heroes, database.counters, database.builds, database.mistakes]
  const { gains, missions } = await database.transaction('rw', tables, async () => {
    const ctx = await missionContext(now, database)
    const has = (pred: (e: SoulsEntry) => boolean) => ctx.entries.some(pred)
    const at = now.getTime()
    const out: SoulsGain[] = []
    if ((ctx.day?.reviewed ?? 0) >= settings.dailyGoal && !has(e => e.reason === 'goal')) {
      out.push(await addSoulsInTx(database, { at, date, amount: GOAL_SOULS, reason: 'goal' }))
    }
    const statuses: MissionStatus[] = []
    for (const id of ids) {
      const def = byId.get(id)
      if (!def) continue
      const status = missionStatus(def, ctx)
      // geschafft, aber noch nicht belohnt (zählt beim Lane-Angriff nach den schon belohnten)
      if (status.done && status.doneSeq === undefined) {
        out.push(await addSoulsInTx(database, { at, date, amount: MISSION_SOULS, reason: 'mission', data: { id } }))
      }
      statuses.push(status)
    }
    const done = statuses.filter(m => m.done).length
    if (ids.length === MISSIONS_PER_DAY && done === MISSIONS_PER_DAY && !has(e => e.reason === 'missions')) {
      out.push(await addSoulsInTx(database, { at, date, amount: ALL_MISSIONS_BONUS, reason: 'missions' }))
    }
    // Lane-Angriff: Siege und Niederlagen zählen ab dem ersten Tag mit drei Missionen
    if (statuses.length === MISSIONS_PER_DAY && !(await getMeta<string | null>('laneStart', null, database))) {
      await setMeta('laneStart', date, database)
    }
    return { gains: out, missions: statuses }
  })
  for (const gain of gains) announceGain(gain)
  // Schaden, zerstörte Ziele, Sieg → kurze Einblendung
  trackLane(laneState(date, missions))
  return gains
}

/** Runde abschließen: Souls (mit Rundenregel) + Tagesmissionen prüfen */
export async function finishRound(
  mode: RoundMode,
  base: number,
  data: Record<string, string | number | boolean>,
  now = new Date(),
  database: DeckDB = db,
): Promise<RoundAward> {
  const award = await awardRound(mode, base, data, now, database)
  await checkDailyBonuses(now, database)
  return award
}
