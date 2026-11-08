/**
 * Tagesmissionen: jeden Tag 3 Aufgaben – die Mission des Helden des Tages (ohne Hero-Daten: eine Lern-Mission) und zwei
 * Spiel-Missionen, fest pro Tag ausgelost. Je +100 Souls, alle drei +150 Bonus, dazu der Tagesziel-Bonus (+100).
 * Freiwillig: der Mid Boss (Schwächen-Training bzw. eine schwere Spiel-Aufgabe). Der Lane-Angriff zeigt das als Kampf.
 */
import { localDate } from '../data/dates'
import { db, getMeta, getSettings, setMeta, type DayRecord, type DeckDB } from '../data/db'
import { LEARNED_ONLY_MIN } from '../data/model'
import { isReverseId, type DeckId } from '../decks'
import { loadLearnedCards } from '../quiz/load'
import { shuffle } from '../quiz/quiz'
import { heroKnowledge, heroOffer, HERO_OFFER_SIZE, makeHeroPick, type HeroMissionMode, type HeroPick } from './dayHero'
import { laneContextOf, laneForDay, laneHistory, laneState, loadLaneHistory, streakBonus, trackLane, type LaneState } from './laneAttack'
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

/** Mid Boss bei zu wenigen Schwächen: schwere Spiel-Aufgaben */
export const HARD_MISSIONS: readonly MissionDef[] = [
  { id: 'quiz-9', kind: 'play', group: 'quiz', title: 'Quiz mit mindestens 9 richtigen Antworten', target: 9,
    available: c => deck(c, 'items') >= 4 && learned(c, 'items'), progress: c => bestOf(c, 'quiz', 'correct') },
  { id: 'sprint-25', kind: 'play', group: 'sprint', title: '60-Sekunden-Sprint mit mindestens 25 richtigen', target: 25,
    available: c => deck(c, 'items') >= 4 && learned(c, 'items', 'abilities', 'heroes'), progress: c => bestOf(c, 'sprint', 'score') },
  { id: 'map-9', kind: 'play', group: 'map', title: 'Map-Quiz mit mindestens 9 richtigen Antworten', target: 9,
    available: c => !!c.mapReady, progress: c => bestOf(c, 'map', 'correct') },
  { id: 'survival-20', kind: 'play', group: 'survival', title: 'Überleben: mindestens 20 Fragen', target: 20,
    available: c => deck(c, 'items') >= 4 && learned(c, 'items'), progress: c => bestOf(c, 'survival', 'score') },
]

const byId = new Map(MISSIONS.map(m => [m.id, m]))
const hardById = new Map(HARD_MISSIONS.map(m => [m.id, m]))

/** Mission des Helden des Tages (ID in der Auslosung) */
export const HERO_MISSION_ID = 'hero'
/** Hero-Mission im Build-Quiz: so viele Fehler sind erlaubt */
export const HERO_BUILD_MAX_ERRORS = 2

/** Hero-Mission – je nach Wahl: seine Karten lernen bzw. wiederholen, Build-Quiz mit ihm; ohne Wahl kein Fortschritt */
export function heroMissionDef(pick?: HeroPick): MissionDef {
  const base = { id: HERO_MISSION_ID, kind: 'learn' as const, group: 'hero', available: () => true }
  if (!pick) return { ...base, title: 'Held des Tages wählen', target: 1, progress: () => 0 }
  if (pick.mode === 'build') {
    return {
      ...base, title: `Build-Quiz mit ${pick.name}: höchstens ${HERO_BUILD_MAX_ERRORS} Fehler`, target: 1,
      progress: c => (c.entries.some(e => e.reason === 'build' && Number(e.data?.heroId) === pick.heroId
        && Number(e.data?.errors ?? Infinity) <= HERO_BUILD_MAX_ERRORS) ? 1 : 0),
    }
  }
  return {
    ...base, title: `Karten von ${pick.name} ${pick.mode === 'learn' ? 'lernen' : 'wiederholen'}`, target: pick.cards.length,
    progress: c => pick.cards.filter(id => c.day?.cards?.includes(id)).length,
  }
}

/** Mid Boss des Tages: Schwächen-Training, bei zu wenigen Schwächen eine schwere Spiel-Aufgabe */
export type MidBossTask = { kind: 'weak'; target: number } | { kind: 'play'; id: string }

export const MID_BOSS_WEAK = 10
export const MID_BOSS_WEAK_MIN = 5

export function pickMidBoss(date: string, ctx: MissionContext): MidBossTask | undefined {
  if (ctx.weakCount >= MID_BOSS_WEAK_MIN) return { kind: 'weak', target: Math.min(MID_BOSS_WEAK, ctx.weakCount) }
  const options = HARD_MISSIONS.filter(m => m.available(ctx))
  if (!options.length) return undefined
  const rng = seededRng(hashString(`boss:${date}`))
  return { kind: 'play', id: options[Math.floor(rng() * options.length)].id }
}

export function midBossDef(task: MidBossTask): MissionDef | undefined {
  if (task.kind === 'play') return hardById.get(task.id)
  return {
    id: 'midboss', kind: 'learn', group: 'midboss', title: `${task.target} Schwächen-Karten üben`, target: task.target,
    available: () => true, progress: c => c.day?.weak?.length ?? 0,
  }
}

export function missionById(id: string): MissionDef | undefined {
  return byId.get(id)
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

/** Missionen des Tages (meta 'missions'): Auslosung, Held des Tages, Mid Boss */
export interface StoredMissions {
  date: string
  /** 3 Missionen; 'hero' = Mission des Helden des Tages */
  ids: string[]
  /** Vorschläge für den Helden des Tages (Hero-Karten-IDs) */
  heroOffer?: string[]
  /** Gewählter Held und seine Mission */
  hero?: HeroPick
  midBoss?: MidBossTask
}

/** Missionen von heute (gespeichert bzw. frisch ausgelost). `store`: neue Auslosung festhalten */
export async function todayMissions(now: Date, database: DeckDB = db, store = false): Promise<StoredMissions> {
  const date = localDate(now)
  const stored = await getMeta<StoredMissions | null>('missions', null, database)
  if (stored?.date === date) return stored
  // „Nur Gelerntes“: Spiel-Missionen nur, wenn die Runden dafür lang genug sind
  const ctx: MissionContext = { ...(await missionContext(now, database)), learnedOnly: await learnedOnlyCounts(database) }
  const offer = ctx.heroCount >= HERO_OFFER_SIZE ? heroOffer(date, await heroKnowledge(database)) : []
  const withHero = offer.length >= HERO_OFFER_SIZE
  const ids = pickMissions(date, MISSIONS.filter(m => m.available(ctx)), withHero)
  const midBoss = pickMidBoss(date, ctx)
  const record: StoredMissions = { date, ids, ...(withHero ? { heroOffer: offer } : {}), ...(midBoss ? { midBoss } : {}) }
  // Erst festhalten, wenn es genug gibt (z. B. noch keine Daten beim allerersten Start)
  if (store && ids.length === MISSIONS_PER_DAY) await setMeta('missions', record, database)
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

export interface DailyStatus {
  missions: MissionStatus[]
  /** Alle drei geschafft → Bonus gutgeschrieben */
  bonus: boolean
  goalReached: boolean
  /** Lane-Angriff des Tages (nur mit drei Missionen) */
  lane: LaneState | null
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

async function describeOffer(ids: readonly string[], database: DeckDB): Promise<HeroChoice[]> {
  const picks = await Promise.all(ids.map(id => makeHeroPick(id, database)))
  return picks
    .filter((p): p is HeroPick => !!p)
    .map(p => ({ id: p.id, name: p.name, ...(p.image ? { image: p.image } : {}), mode: p.mode, cards: p.cards.length }))
}

/** Nur lesen (für die Startseite) */
export async function dailyStatus(now = new Date(), database: DeckDB = db): Promise<DailyStatus> {
  const date = localDate(now)
  const stored = await todayMissions(now, database)
  const ctx = await missionContext(now, database)
  const missions = missionDefs(stored).map(def => missionStatus(def, ctx))
  const midBoss = midBossStatus(stored, ctx)
  const heroMission = missions.find(m => m.def.id === HERO_MISSION_ID)
  const canChange = !!heroMission && heroMission.progress === 0 && !heroMission.done
  const hero = stored.hero && heroMission ? { ...stored.hero, canChange } : undefined
  const heroOffer = heroMission && stored.heroOffer && (!stored.hero || canChange) ? await describeOffer(stored.heroOffer, database) : undefined
  const history = await loadLaneHistory(now, database)
  const lane = laneState(date, missions, {
    ...laneContextOf(history, date),
    ...(hero ? { hero: { id: hero.id, name: hero.name, ...(hero.image ? { image: hero.image } : {}) } } : {}),
    ...(midBoss ? { midBoss: { title: midBoss.def.title, progress: midBoss.progress, target: midBoss.def.target, done: midBoss.done } } : {}),
  })
  return {
    missions,
    bonus: ctx.entries.some(e => e.reason === 'missions'),
    goalReached: ctx.entries.some(e => e.reason === 'goal'),
    lane,
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
  const pick = await makeHeroPick(heroCardId, database)
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
        data: { lane: laneForDay(date).lane, patron, revenge, ...(stored.hero ? { hero: stored.hero.id } : {}) },
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
