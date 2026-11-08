/**
 * Tagesmissionen: jeden Tag 3 Aufgaben – die Mission des Helden des Tages (ohne Hero-Daten: eine Lern-Mission) und zwei
 * Spiel-Missionen, fest pro Tag ausgelost. Je +100 Souls, alle drei +150 Bonus, dazu der Tagesziel-Bonus (+100).
 * Die Ziele richten sich nach der Stufe aus dem höchsten Rang (missionLevels.ts): am Anfang leicht, ab Wächter 1 voll.
 * Freiwillig: der Mid Boss (Schwächen-Training bzw. eine Aufgabe eine Stufe darüber). Der Lane-Angriff zeigt das als
 * Kampf; die Lane lässt sich einmal am Tag gegen Souls tauschen (neue offene Spiel-Missionen).
 */
import { localDate } from '../data/dates'
import { db, getMeta, getSettings, setMeta, type DayRecord, type DeckDB } from '../data/db'
import { LEARNED_ONLY_MIN } from '../data/model'
import { isReverseId, type DeckId } from '../decks'
import type { Lane } from '../map/mapData'
import { loadLearnedCards } from '../quiz/load'
import { shuffle, type Rng } from '../quiz/quiz'
import { heroKnowledge, heroOffer, HERO_OFFER_SIZE, makeHeroPick, type HeroMissionMode, type HeroPick } from './dayHero'
import {
  ATTACK_LANES, laneContextOf, laneForDay, laneHistory, laneState, loadLaneHistory, streakBonus, trackLane, type LaneState,
} from './laneAttack'
import { asLevel, missionLevel, nextUnlock, swapPrice, TOP_LEVEL, type MissionLevel, type NextUnlock } from './missionLevels'
import { hashString, seededRng } from './random'
import {
  addSoulsInTx, announceGain, awardRound, getSoulsBest, getSoulsTotal, GOAL_SOULS,
  type RoundAward, type RoundMode, type SoulsEntry, type SoulsGain,
} from './souls'
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
const fmt = (n: number) => n.toLocaleString('de-DE')
const quizReady = (c: MissionContext) => deck(c, 'items') >= 4 && learned(c, 'items')

export const LEARN_MISSIONS: readonly MissionDef[] = [
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
]

// ---------- Spiel-Missionen je Art (das Ziel kommt aus der Stufe) ----------

const quizCorrect = (n: number): MissionDef => ({
  id: `quiz-${n}`, kind: 'play', group: 'quiz', title: `Quiz mit mindestens ${n} richtigen Antworten`, target: n,
  available: quizReady, progress: c => bestOf(c, 'quiz', 'correct'),
})
const quizScore = (n: number): MissionDef => ({
  id: `quiz-${n}`, kind: 'play', group: 'quiz', title: `Quiz-Runde mit mindestens ${fmt(n)} Punkten`, target: n,
  available: quizReady, progress: c => bestOf(c, 'quiz', 'score'),
})
const guess = (n: number): MissionDef => ({
  id: `guess-${n}`, kind: 'play', group: 'guess', title: `Hero erraten mit mindestens ${n} Punkten`, target: n,
  available: c => c.heroCount >= 4 && learned(c, 'heroes'), progress: c => bestOf(c, 'guess', 'score'),
})
/** Build-Quiz mit höchstens n Fehlern (0 = ohne Fehler) */
const buildQuiz = (n: number): MissionDef => ({
  id: n === 0 ? 'build-clean' : `build-${n}`, kind: 'play', group: 'build',
  title: n === 0 ? 'Build-Quiz ohne Fehler' : `Build-Quiz mit höchstens ${n} Fehlern`, target: 1,
  available: c => c.buildCount > 0,
  progress: c => (c.entries.some(e => e.reason === 'build' && Number(e.data?.errors ?? Infinity) <= n) ? 1 : 0),
})
const sprint = (n: number): MissionDef => ({
  id: `sprint-${n}`, kind: 'play', group: 'sprint', title: `60-Sekunden-Sprint mit mindestens ${n} richtigen`, target: n,
  available: c => deck(c, 'items') >= 4 && learned(c, 'items', 'abilities', 'heroes'), progress: c => bestOf(c, 'sprint', 'score'),
})
const mapQuiz = (n: number): MissionDef => ({
  id: `map-${n}`, kind: 'play', group: 'map', title: `Map-Quiz mit mindestens ${n} richtigen Antworten`, target: n,
  available: c => !!c.mapReady, progress: c => bestOf(c, 'map', 'correct'),
})
const survival = (n: number): MissionDef => ({
  id: `survival-${n}`, kind: 'play', group: 'survival', title: `Überleben: mindestens ${n} Fragen`, target: n,
  available: quizReady, progress: c => bestOf(c, 'survival', 'score'),
})

interface Ladder {
  make: (value: number) => MissionDef
  /** Ziel je Stufe 0–3 (null = auf dieser Stufe noch keine Mission) */
  values: readonly (number | null)[]
  /** Mid Boss auf der höchsten Stufe (schwere Aufgabe) – fehlt: diese Art kommt nicht als Mid Boss */
  boss?: number
}

/** Ziele je Stufe: Start · Kultist 1 · Akolyth 1 · Wächter 1 (= die bisherigen Ziele) */
const LADDERS: readonly Ladder[] = [
  { make: quizCorrect, values: [5, 6, 7, 7], boss: 9 },
  { make: quizScore, values: [null, null, 800, 1000] },
  { make: guess, values: [null, 400, 500, 600] },
  { make: buildQuiz, values: [null, null, 3, 0] },
  { make: sprint, values: [null, 10, 12, 15], boss: 25 },
  { make: mapQuiz, values: [5, 6, 7, 7], boss: 9 },
  { make: survival, values: [5, 7, 10, 10], boss: 20 },
]

/** Missionen einer Stufe: alle Lern-Missionen und die Spiel-Missionen mit ihrem Ziel auf dieser Stufe */
export function missionsForLevel(level: MissionLevel): MissionDef[] {
  return [...LEARN_MISSIONS, ...LADDERS.flatMap(l => {
    const value = l.values[level]
    return value === null ? [] : [l.make(value)]
  })]
}

/** Alle Missionen der höchsten Stufe (die Ziele von vor den Stufen) */
export const MISSIONS: readonly MissionDef[] = missionsForLevel(TOP_LEVEL)

/** Mid-Boss-Aufgaben einer Stufe: die Ziele der nächsten Stufe, auf der höchsten die schweren */
export function bossMissionsForLevel(level: MissionLevel): MissionDef[] {
  return LADDERS.flatMap(l => {
    if (l.boss === undefined) return []
    const value = level < TOP_LEVEL ? l.values[level + 1] : l.boss
    return value === null ? [] : [l.make(value)]
  })
}

/** Jede Mission (alle Stufen, Mid Boss) nach ID – auch für Auslosungen von vor einem Update */
const byId = new Map<string, MissionDef>()
/** Ab welcher Stufe eine Mission dran ist (schwere Mid-Boss-Aufgaben: über der höchsten) */
const levelOfId = new Map<string, number>()
for (const m of LEARN_MISSIONS) {
  byId.set(m.id, m)
  levelOfId.set(m.id, 0)
}
for (const l of LADDERS) {
  l.values.forEach((value, level) => {
    if (value === null) return
    const m = l.make(value)
    if (!byId.has(m.id)) {
      byId.set(m.id, m)
      levelOfId.set(m.id, level)
    }
  })
  if (l.boss !== undefined) {
    const m = l.make(l.boss)
    if (!byId.has(m.id)) {
      byId.set(m.id, m)
      levelOfId.set(m.id, TOP_LEVEL + 1)
    }
  }
}

/** Mission des Helden des Tages (ID in der Auslosung) */
export const HERO_MISSION_ID = 'hero'
/** Hero-Mission im Build-Quiz: so viele Fehler sind erlaubt (Auslosungen von vor den Stufen) */
export const HERO_BUILD_MAX_ERRORS = 2

/** Hero-Mission – je nach Wahl: seine Karten lernen bzw. wiederholen, Build-Quiz mit ihm; ohne Wahl kein Fortschritt */
export function heroMissionDef(pick?: HeroPick): MissionDef {
  const base = { id: HERO_MISSION_ID, kind: 'learn' as const, group: 'hero', available: () => true }
  if (!pick) return { ...base, title: 'Held des Tages wählen', target: 1, progress: () => 0 }
  if (pick.mode === 'build') {
    const max = pick.maxErrors ?? HERO_BUILD_MAX_ERRORS
    return {
      ...base, title: `Build-Quiz mit ${pick.name}: höchstens ${max} Fehler`, target: 1,
      progress: c => (c.entries.some(e => e.reason === 'build' && Number(e.data?.heroId) === pick.heroId
        && Number(e.data?.errors ?? Infinity) <= max) ? 1 : 0),
    }
  }
  return {
    ...base, title: `Karten von ${pick.name} ${pick.mode === 'learn' ? 'lernen' : 'wiederholen'}`, target: pick.cards.length,
    progress: c => pick.cards.filter(id => c.day?.cards?.includes(id)).length,
  }
}

/** Mid Boss des Tages: Schwächen-Training, bei zu wenigen Schwächen eine Spiel-Aufgabe eine Stufe über der eigenen */
export type MidBossTask = { kind: 'weak'; target: number } | { kind: 'play'; id: string }

export const MID_BOSS_WEAK = 10
export const MID_BOSS_WEAK_MIN = 5

/** `missions`: die Tagesmissionen – der Mid Boss ist nie dieselbe Aufgabe */
export function pickMidBoss(
  date: string, ctx: MissionContext, level: MissionLevel = TOP_LEVEL, missions: readonly string[] = [],
): MidBossTask | undefined {
  if (ctx.weakCount >= MID_BOSS_WEAK_MIN) return { kind: 'weak', target: Math.min(MID_BOSS_WEAK, ctx.weakCount) }
  const options = bossMissionsForLevel(level).filter(m => m.available(ctx) && !missions.includes(m.id))
  if (!options.length) return undefined
  const rng = seededRng(hashString(`boss:${date}`))
  return { kind: 'play', id: options[Math.floor(rng() * options.length)].id }
}

export function midBossDef(task: MidBossTask): MissionDef | undefined {
  if (task.kind === 'play') return byId.get(task.id)
  return {
    id: 'midboss', kind: 'learn', group: 'midboss', title: `${task.target} Schwächen-Karten üben`, target: task.target,
    available: () => true, progress: c => c.day?.weak?.length ?? 0,
  }
}

export function missionById(id: string): MissionDef | undefined {
  return byId.get(id)
}

/** Ab welcher Stufe eine Mission dran ist (unbekannt: 0) */
export function missionMinLevel(id: string): number {
  return levelOfId.get(id) ?? 0
}

/**
 * Eine Lern- und zwei Spiel-Missionen aus verschiedenen Gruppen; fehlt etwas, wird aufgefüllt.
 * `withHero`: statt der Lern-Mission die Mission des Helden des Tages (an erster Stelle).
 */
export function pickMissions(date: string, available: readonly MissionDef[], withHero = false): string[] {
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
  const wanted = withHero ? MISSIONS_PER_DAY - 1 : MISSIONS_PER_DAY
  if (!withHero) take(learn)
  take(play)
  take(play)
  // zu wenige Spiel-Modi (z. B. noch keine Hero-Daten): mit weiteren Missionen auffüllen
  for (const m of [...play, ...learn]) {
    if (picked.length >= wanted) break
    if (!picked.includes(m)) picked.push(m)
  }
  const ids = picked.slice(0, wanted).map(m => m.id)
  return withHero ? [HERO_MISSION_ID, ...ids] : ids
}

/**
 * Ersatz für einzelne Missionen (zu schwer nach den Stufen, Lane getauscht): andere Gruppen als die bleibenden,
 * zuerst Spiel-, dann Lern-Missionen; `avoid` (z. B. die getauschten) nie. Heute schon geschaffte Missionen nur zur
 * Not – sonst ließe sich ein Tausch mit Erledigtem auszahlen.
 */
export function drawReplacements(
  rng: Rng, available: readonly MissionDef[], keep: readonly string[], count: number, avoid: readonly string[], ctx?: MissionContext,
): string[] {
  const groups = new Set(keep.map(id => (id === HERO_MISSION_ID ? 'hero' : byId.get(id)?.group)).filter(g => g !== undefined))
  const candidates = [
    ...shuffle(available.filter(m => m.kind === 'play'), rng),
    ...shuffle(available.filter(m => m.kind === 'learn'), rng),
  ].filter(m => !avoid.includes(m.id) && !keep.includes(m.id))
  const done = (m: MissionDef) => !!ctx && missionStatus(m, ctx).done
  const open = candidates.filter(m => !done(m))
  const out: MissionDef[] = []
  for (const m of open) {
    if (out.length >= count) break
    if (!groups.has(m.group)) {
      out.push(m)
      groups.add(m.group)
    }
  }
  // zu wenige Gruppen: auch aus schon vertretenen, zuletzt schon geschaffte
  for (const m of [...open, ...candidates.filter(done)]) {
    if (out.length >= count) break
    if (!out.includes(m)) out.push(m)
  }
  return out.map(m => m.id)
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

/** Missionen des Tages (meta 'missions'): Auslosung, Held des Tages, Mid Boss, Lane-Tausch */
export interface StoredMissions {
  date: string
  /** 3 Missionen; 'hero' = Mission des Helden des Tages */
  ids: string[]
  /** Stufe der Auslosung (fest für den Tag) – fehlt bei Auslosungen von vor den Stufen */
  level?: MissionLevel
  /** Vorschläge für den Helden des Tages (Hero-Karten-IDs) */
  heroOffer?: string[]
  /** Gewählter Held und seine Mission */
  hero?: HeroPick
  midBoss?: MidBossTask
  /** Lane getauscht: die neue Lane des Tages */
  lane?: Lane
  /** Beim Tausch ersetzte Missionen (kommen nicht wieder) */
  swapped?: string[]
}

/** Missionen von heute (gespeichert bzw. frisch ausgelost). `store`: neue Auslosung festhalten */
export async function todayMissions(now: Date, database: DeckDB = db, store = false): Promise<StoredMissions> {
  const date = localDate(now)
  const stored = await getMeta<StoredMissions | null>('missions', null, database)
  if (stored?.date === date) {
    if (asLevel(stored.level) !== undefined) return stored
    // Auslosung von vor den Stufen: an die Stufe anpassen (einmal, beim Festhalten)
    const adapted = await adaptToLevel(stored, now, database)
    if (store) await setMeta('missions', adapted, database)
    return adapted
  }
  // „Nur Gelerntes“: Spiel-Missionen nur, wenn die Runden dafür lang genug sind
  const ctx: MissionContext = { ...(await missionContext(now, database)), learnedOnly: await learnedOnlyCounts(database) }
  const level = missionLevel(await getSoulsBest(database))
  const offer = ctx.heroCount >= HERO_OFFER_SIZE ? heroOffer(date, await heroKnowledge(database)) : []
  const withHero = offer.length >= HERO_OFFER_SIZE
  const ids = pickMissions(date, missionsForLevel(level).filter(m => m.available(ctx)), withHero)
  const midBoss = pickMidBoss(date, ctx, level, ids)
  const record: StoredMissions = { date, level, ids, ...(withHero ? { heroOffer: offer } : {}), ...(midBoss ? { midBoss } : {}) }
  // Erst festhalten, wenn es genug gibt (z. B. noch keine Daten beim allerersten Start)
  if (store && ids.length === MISSIONS_PER_DAY) await setMeta('missions', record, database)
  return record
}

/**
 * Auslosung von vor den Stufen: Missionen über der Stufe werden ersetzt – nur, solange sie keinen Fortschritt haben.
 * Ebenso der Mid Boss (mehr als eine Stufe darüber) und das Build-Quiz des Helden (Fehler je nach Stufe).
 */
async function adaptToLevel(stored: StoredMissions, now: Date, database: DeckDB): Promise<StoredMissions> {
  const level = missionLevel(await getSoulsBest(database))
  const ctx = await missionContext(now, database)
  const untouched = (status: MissionStatus | undefined) => !!status && status.progress === 0 && !status.done
  const tooHard = stored.ids.filter(id => {
    const def = byId.get(id)
    return !!def && missionMinLevel(id) > level && untouched(missionStatus(def, ctx))
  })
  let ids = stored.ids
  if (tooHard.length) {
    const keep = stored.ids.filter(id => !tooHard.includes(id))
    const rng = seededRng(hashString(`level:${stored.date}`))
    const fresh = drawReplacements(rng, missionsForLevel(level).filter(m => m.available(ctx)), keep, tooHard.length, stored.ids, ctx)
    let k = 0
    ids = stored.ids.map(id => (tooHard.includes(id) ? fresh[k++] ?? id : id))
  }
  let midBoss = stored.midBoss
  if (midBoss?.kind === 'play' && missionMinLevel(midBoss.id) > level + 1 && untouched(midBossStatus(stored, ctx))) {
    midBoss = pickMidBoss(stored.date, ctx, level, ids)
  }
  let hero = stored.hero
  if (hero?.mode === 'build' && hero.maxErrors === undefined && untouched(missionStatus(heroMissionDef(hero), ctx))) {
    hero = (await makeHeroPick(hero.id, database, level)) ?? hero
  }
  const record: StoredMissions = { ...stored, ids, level }
  if (midBoss) record.midBoss = midBoss
  else delete record.midBoss
  if (hero) record.hero = hero
  return record
}

export async function todayMissionIds(now: Date, database: DeckDB = db, store = false): Promise<string[]> {
  return (await todayMissions(now, database, store)).ids
}

/** Missionen der Auslosung (unbekannte IDs, z. B. nach einem Update, fallen weg) */
function missionDefs(stored: StoredMissions): MissionDef[] {
  return stored.ids
    .map(id => (id === HERO_MISSION_ID ? heroMissionDef(stored.hero) : byId.get(id)))
    .filter((m): m is MissionDef => !!m)
}

export interface MissionStatus {
  def: MissionDef
  progress: number
  done: boolean
  /** Schon gutgeschrieben */
  rewarded: boolean
}

/** Held des Tages mit seiner Mission */
export interface DayHero extends HeroPick {
  /** Wechseln geht, solange seine Mission noch bei 0 steht */
  canChange: boolean
}

/** Vorschlag für den Helden des Tages – mit der Mission, die er bekäme */
export interface HeroChoice {
  id: string
  name: string
  image?: string
  mode: HeroMissionMode
  /** learn/review: Anzahl Karten */
  cards: number
}

/** Lane tauschen: Preis und ob es gerade geht */
export interface SwapInfo {
  price: number
  /** Kontostand jetzt */
  balance: number
  /** Offene Spiel-Missionen (werden neu ausgelost) */
  open: number
  /** Heute schon getauscht */
  used: boolean
  possible: boolean
  /** Warum nicht (für die Anzeige) */
  reason?: string
}

export interface DailyStatus {
  missions: MissionStatus[]
  /** Alle drei geschafft → Bonus gutgeschrieben */
  bonus: boolean
  goalReached: boolean
  /** Lane-Angriff des Tages (nur mit drei Missionen) */
  lane: LaneState | null
  /** Stufe der heutigen Auslosung */
  level: MissionLevel
  /** Nächste Freischaltung bei den Missionen (vom höchsten Rang aus) */
  nextUnlock?: NextUnlock
  /** Lane tauschen (nur mit Lane-Angriff) */
  swap?: SwapInfo
  /** Gewählter Held des Tages */
  hero?: DayHero
  /** Vorschläge, solange (noch) gewählt werden kann */
  heroOffer?: HeroChoice[]
  /** Mid Boss (freiwillig) */
  midBoss?: MissionStatus
}

/** Stand einer Mission – geschafft, sobald belohnt oder das Ziel erreicht ist */
function missionStatus(def: MissionDef, ctx: MissionContext): MissionStatus {
  const progress = def.progress(ctx)
  const rewarded = ctx.entries.some(e => e.reason === 'mission' && e.data?.id === def.id)
  return { def, progress: Math.min(progress, def.target), done: rewarded || progress >= def.target, rewarded }
}

function midBossStatus(stored: StoredMissions, ctx: MissionContext): MissionStatus | undefined {
  const def = stored.midBoss && midBossDef(stored.midBoss)
  if (!def) return undefined
  const progress = def.progress(ctx)
  const rewarded = ctx.entries.some(e => e.reason === 'midboss')
  return { def, progress: Math.min(progress, def.target), done: rewarded || progress >= def.target, rewarded }
}

async function describeOffer(ids: readonly string[], level: MissionLevel, database: DeckDB): Promise<HeroChoice[]> {
  const picks = await Promise.all(ids.map(id => makeHeroPick(id, database, level)))
  return picks
    .filter((p): p is HeroPick => !!p)
    .map(p => ({ id: p.id, name: p.name, ...(p.image ? { image: p.image } : {}), mode: p.mode, cards: p.cards.length }))
}

/** Offene Spiel-Missionen – die tauscht „Lane tauschen“ aus */
function openPlayMissions(missions: readonly MissionStatus[]): string[] {
  return missions.filter(m => m.def.kind === 'play' && !m.done).map(m => m.def.id)
}

function swapInfo(stored: StoredMissions, ctx: MissionContext, missions: readonly MissionStatus[], lane: LaneState, balance: number): SwapInfo {
  const price = swapPrice(balance)
  const open = openPlayMissions(missions).length
  const used = !!stored.lane || ctx.entries.some(e => e.reason === 'swap')
  const reason = used ? 'Heute schon getauscht'
    : lane.won ? 'Der Patron ist schon gefallen'
    : !open ? 'Keine offene Spiel-Mission'
    : balance < price ? `Dir fehlen ${fmt(price - balance)} ◆`
    : undefined
  return { price, balance, open, used, possible: !reason, ...(reason ? { reason } : {}) }
}

/** Nur lesen (für die Startseite) */
export async function dailyStatus(now = new Date(), database: DeckDB = db): Promise<DailyStatus> {
  const date = localDate(now)
  const stored = await todayMissions(now, database)
  const level = asLevel(stored.level) ?? TOP_LEVEL
  const [ctx, best, balance] = await Promise.all([missionContext(now, database), getSoulsBest(database), getSoulsTotal(database)])
  const missions = missionDefs(stored).map(def => missionStatus(def, ctx))
  const midBoss = midBossStatus(stored, ctx)
  const heroMission = missions.find(m => m.def.id === HERO_MISSION_ID)
  const canChange = !!heroMission && heroMission.progress === 0 && !heroMission.done
  const hero = stored.hero && heroMission ? { ...stored.hero, canChange } : undefined
  const heroOffer = heroMission && stored.heroOffer && (!stored.hero || canChange)
    ? await describeOffer(stored.heroOffer, level, database)
    : undefined
  const history = await loadLaneHistory(now, database)
  const lane = laneState(date, missions, {
    ...laneContextOf(history, date),
    ...(stored.lane ? { lane: stored.lane } : {}),
    ...(hero ? { hero: { id: hero.id, name: hero.name, ...(hero.image ? { image: hero.image } : {}) } } : {}),
    ...(midBoss ? { midBoss: { title: midBoss.def.title, progress: midBoss.progress, target: midBoss.def.target, done: midBoss.done } } : {}),
  })
  const unlock = nextUnlock(best)
  return {
    missions,
    bonus: ctx.entries.some(e => e.reason === 'missions'),
    goalReached: ctx.entries.some(e => e.reason === 'goal'),
    lane,
    level,
    ...(unlock ? { nextUnlock: unlock } : {}),
    ...(lane ? { swap: swapInfo(stored, ctx, missions, lane, balance) } : {}),
    ...(hero ? { hero } : {}),
    ...(heroOffer?.length ? { heroOffer } : {}),
    ...(midBoss ? { midBoss } : {}),
  }
}

/**
 * Held des Tages wählen (aus den Vorschlägen) – wechseln nur, solange seine Mission noch bei 0 steht.
 * Die Mission wird jetzt festgelegt (seine noch nicht gelernten Karten, sonst Build-Quiz, sonst Wiederholen).
 */
export async function chooseHero(heroCardId: string, now = new Date(), database: DeckDB = db): Promise<boolean> {
  const stored = await todayMissions(now, database, true)
  if (stored.ids.length !== MISSIONS_PER_DAY || !stored.ids.includes(HERO_MISSION_ID) || !stored.heroOffer?.includes(heroCardId)) return false
  if (stored.hero?.id === heroCardId) return true
  if (stored.hero) {
    const current = missionStatus(heroMissionDef(stored.hero), await missionContext(now, database))
    if (current.progress > 0 || current.done) return false
  }
  const pick = await makeHeroPick(heroCardId, database, asLevel(stored.level) ?? TOP_LEVEL)
  if (!pick) return false
  await setMeta('missions', { ...stored, hero: pick }, database)
  return true
}

/** Hero-Session: die Karten seiner Mission, die heute noch nicht dran waren */
export async function heroSessionCards(now = new Date(), database: DeckDB = db): Promise<{ hero: HeroPick; ids: string[] } | null> {
  const stored = await todayMissions(now, database)
  if (!stored.hero || stored.hero.mode === 'build') return null
  const day = await database.days.get(localDate(now))
  return { hero: stored.hero, ids: stored.hero.cards.filter(id => !day?.cards?.includes(id)) }
}

export interface SwapResult {
  lane: Lane
  price: number
  /** Neue Missionen des Tages */
  ids: string[]
}

/**
 * Lane tauschen (1× am Tag, gegen Souls): neue Lane-Farbe, gleicher Gegner; die offenen Spiel-Missionen werden neu
 * ausgelost (nie die getauschten), geschaffte Missionen, Held und Mid Boss bleiben. null = geht gerade nicht.
 */
export async function swapLane(now = new Date(), database: DeckDB = db): Promise<SwapResult | null> {
  const date = localDate(now)
  const stored = await todayMissions(now, database, true)
  const status = await dailyStatus(now, database)
  if (!status.lane || !status.swap?.possible) return null
  const open = openPlayMissions(status.missions)
  const keep = stored.ids.filter(id => !open.includes(id))
  const ctx = await missionContext(now, database)
  const rng = seededRng(hashString(`swap:${date}`))
  const available = missionsForLevel(status.level).filter(m => m.available(ctx))
  const fresh = drawReplacements(rng, available, keep, open.length, [...stored.ids, ...(stored.swapped ?? [])], ctx)
  if (fresh.length < open.length) return null
  let k = 0
  const ids = stored.ids.map(id => (open.includes(id) ? fresh[k++] : id))
  const from = status.lane.lane
  const lanes = ATTACK_LANES.filter(l => l !== from)
  const lane = lanes[Math.floor(rng() * lanes.length)]
  const price = status.swap.price
  const gain = await database.transaction('rw', database.souls, database.meta, async () => {
    // nochmals prüfen (z. B. ein zweiter Tab)
    const current = await getMeta<StoredMissions | null>('missions', null, database)
    if (current?.date !== date || current.lane || current.ids.join() !== stored.ids.join()) return null
    if ((await getSoulsTotal(database)) < price) return null
    const spent = await addSoulsInTx(database, { at: now.getTime(), date, amount: -price, reason: 'swap', data: { lane, from } })
    await setMeta('missions', { ...current, ids, lane, swapped: open }, database)
    return spent
  })
  if (!gain) return null
  announceGain({ ...gain, label: '🔄 Lane getauscht' })
  trackLane((await dailyStatus(now, database)).lane)
  return { lane, price, ids }
}

/**
 * Tagesziel-Bonus, geschaffte Missionen, Mid Boss und Sieg (mit Serien-Bonus) gutschreiben – jeweils einmal pro Tag.
 * Danach den Lane-Angriff melden (Einblendungen in Sessions und Spielen).
 */
export async function checkDailyBonuses(now = new Date(), database: DeckDB = db): Promise<SoulsGain[]> {
  const date = localDate(now)
  const stored = await todayMissions(now, database, true)
  const settings = await getSettings(database)
  const tables = [database.souls, database.meta, database.days, database.items, database.abilities, database.heroes, database.counters, database.builds, database.mistakes]
  const gains = await database.transaction('rw', tables, async () => {
    const ctx = await missionContext(now, database)
    const has = (pred: (e: SoulsEntry) => boolean) => ctx.entries.some(pred)
    const at = now.getTime()
    const out: SoulsGain[] = []
    if ((ctx.day?.reviewed ?? 0) >= settings.dailyGoal && !has(e => e.reason === 'goal')) {
      out.push(await addSoulsInTx(database, { at, date, amount: GOAL_SOULS, reason: 'goal' }))
    }
    const statuses = missionDefs(stored).map(def => missionStatus(def, ctx))
    for (const status of statuses) {
      if (status.done && !status.rewarded) {
        out.push(await addSoulsInTx(database, { at, date, amount: MISSION_SOULS, reason: 'mission', data: { id: status.def.id } }))
      }
    }
    // Lane-Angriff: Siege und Niederlagen zählen ab dem ersten Tag mit drei Missionen
    if (statuses.length === MISSIONS_PER_DAY && !(await getMeta<string | null>('laneStart', null, database))) {
      await setMeta('laneStart', date, database)
    }
    // Mid Boss besiegt: Eintrag ohne Souls (der Rejuvenator ergibt sich daraus)
    const boss = midBossStatus(stored, ctx)
    if (boss?.done && !boss.rewarded) {
      await addSoulsInTx(database, { at, date, amount: 0, reason: 'midboss', data: { task: boss.def.title } })
    }
    if (statuses.length === MISSIONS_PER_DAY && statuses.every(m => m.done) && !has(e => e.reason === 'missions')) {
      // Sieg: Gegner und Serie aus dem Verlauf (heute zählt noch nicht mit)
      const history = laneHistory(await database.souls.toArray(), await getMeta<string | null>('laneStart', null, database), date)
      const { patron, revenge } = history.today
      out.push(await addSoulsInTx(database, {
        at, date, amount: ALL_MISSIONS_BONUS, reason: 'missions',
        data: { lane: stored.lane ?? laneForDay(date).lane, patron, revenge, ...(stored.hero ? { hero: stored.hero.id } : {}) },
      }))
      const streak = history.summary.streak + 1
      const gain = await addSoulsInTx(database, { at, date, amount: streakBonus(streak, revenge), reason: 'streak', data: { streak, revenge } })
      out.push({ ...gain, label: revenge ? `⚔ Revanche · Serie ${streak}` : `🔥 Serie ${streak}` })
    }
    return out
  })
  for (const gain of gains) announceGain(gain)
  // Schaden, zerstörte Ziele, Mid Boss, Sieg → kurze Einblendung
  trackLane((await dailyStatus(now, database)).lane)
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
