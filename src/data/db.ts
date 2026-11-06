import Dexie, { type EntityTable } from 'dexie'
import type { Card } from 'ts-fsrs'
import type { DeckId } from '../decks'
import type { SoulsEntry } from '../game/souls'
import type { MistakeEntry } from '../game/weakness'
import type { PatchRecord } from './patches'
import { GUESS_KINDS, LEGACY_QUIZ_KINDS, QUIZ_KINDS, type AbilityCard, type BuildRecord, type CounterCard, type GuessKind, type HeroCard, type ItemCard, type QuizKind, type SlotType } from './model'

export interface ReviewRecord extends Card {
  /** Karten-ID, z. B. "item:upgrade_headshot_booster" */
  id: string
  /** Per „Jetzt lernen“ vorgemerkt: kommt in die nächste Session, auch wenn die Kategorie ausgeblendet ist */
  requested?: boolean
}

export interface DayRecord {
  /** Lokales Datum YYYY-MM-DD */
  date: string
  /** Verschiedene Karten, die heute bewertet wurden (zählt fürs Tagesziel) */
  reviewed: number
  /** IDs der heute bewerteten Karten – jede Karte zählt nur einmal pro Tag */
  cards?: string[]
  /** Neue Karten insgesamt */
  newIntroduced: number
  /** Neue Karten je Deck (für das Neu-Limit je Deck); fehlt bei Tagen von vor den Hero-Decks */
  newByDeck?: Partial<Record<DeckId, number>>
  /** Heute im Schwächen-Training bewertete Karten (für die Mission) */
  weak?: string[]
}

export interface MetaRecord {
  key: string
  value: unknown
}

export interface Settings {
  dailyGoal: number
  newPerDay: number
  slots: SlotType[]
  /** Fragetypen, die im Quiz vorkommen */
  quizKinds: QuizKind[]
  /** Fragetypen, die es beim Speichern gab – neu hinzugekommene sind dann automatisch an */
  knownQuizKinds?: QuizKind[]
  /** Varianten beim Hero-Erraten */
  guessKinds: GuessKind[]
  /** Animationen und Vibration (Souls, Aufstieg, Fehler) */
  effects: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  dailyGoal: 20,
  newPerDay: 10,
  slots: ['weapon', 'vitality', 'spirit'],
  quizKinds: [...QUIZ_KINDS],
  guessKinds: [...GUESS_KINDS],
  effects: true,
}

export class DeckDB extends Dexie {
  items!: EntityTable<ItemCard, 'id'>
  heroes!: EntityTable<HeroCard, 'id'>
  abilities!: EntityTable<AbilityCard, 'id'>
  /** Counter-Karten (Statistik der API, wöchentlich neu) */
  counters!: EntityTable<CounterCard, 'id'>
  /** Builds fürs Build-Quiz (typisch + Community, wöchentlich neu) */
  builds!: EntityTable<BuildRecord, 'id'>
  /** Souls-Verlauf (Rang, Statistik, Tagesmissionen) */
  souls!: EntityTable<SoulsEntry, 'id'>
  /** Fehler aus allen Modi (Schwächen-Training, 14 Tage) */
  mistakes!: EntityTable<MistakeEntry, 'id'>
  /** Im Sync erkannte Patch-Änderungen (neueste je Karte) */
  patches!: EntityTable<PatchRecord, 'id'>
  reviews!: EntityTable<ReviewRecord, 'id'>
  days!: EntityTable<DayRecord, 'date'>
  meta!: EntityTable<MetaRecord, 'key'>

  constructor(name = 'deadlockdeck') {
    super(name)
    this.version(1).stores({
      items: 'id, slot, tier',
      reviews: 'id, due, state',
      days: 'date',
      meta: 'key',
    })
    // Hero-Decks
    this.version(2).stores({
      heroes: 'id',
      abilities: 'id, heroId',
    })
    // Patch-Erkennung
    this.version(3).stores({
      patches: 'id, detectedAt',
    })
    // Counter-Deck
    this.version(4).stores({
      counters: 'id',
    })
    // Build-Quiz
    this.version(5).stores({
      builds: 'id, source',
    })
    // Souls & Rang
    this.version(6).stores({
      souls: '++id, date, reason',
    })
    // Schwächen-Training
    this.version(7).stores({
      mistakes: '++id, cardId, date',
    })
  }
}

export const db = new DeckDB()

export async function getMeta<T>(key: string, fallback: T, database: DeckDB = db): Promise<T> {
  const rec = await database.meta.get(key)
  return rec === undefined ? fallback : (rec.value as T)
}

export async function setMeta(key: string, value: unknown, database: DeckDB = db): Promise<void> {
  await database.meta.put({ key, value })
}

export async function getSettings(database: DeckDB = db): Promise<Settings> {
  const stored = await getMeta<Partial<Settings>>('settings', {}, database)
  const settings = { ...DEFAULT_SETTINGS, ...stored }
  // Fragetypen, die nach dem Speichern dazugekommen sind (z. B. Counter), sind an
  const known = stored.knownQuizKinds ?? LEGACY_QUIZ_KINDS
  const added = QUIZ_KINDS.filter(k => !known.includes(k) && !settings.quizKinds.includes(k))
  return { ...settings, quizKinds: [...settings.quizKinds, ...added], knownQuizKinds: [...QUIZ_KINDS] }
}

export async function saveSettings(settings: Settings, database: DeckDB = db): Promise<void> {
  await setMeta('settings', settings, database)
}

export type HighscoreKey = 'quizHighscore' | 'guessHighscore'

export async function getHighscore(key: HighscoreKey, database: DeckDB = db): Promise<number> {
  return getMeta<number>(key, 0, database)
}

/** Speichert den Punktestand, wenn er ein neuer Highscore ist. Gibt true zurück, wenn ja. */
export async function submitHighscore(key: HighscoreKey, score: number, database: DeckDB = db): Promise<boolean> {
  return database.transaction('rw', database.meta, async () => {
    const best = await getHighscore(key, database)
    if (score <= best) return false
    await setMeta(key, score, database)
    return true
  })
}

export const getQuizHighscore = (database: DeckDB = db) => getHighscore('quizHighscore', database)
export const submitQuizScore = (score: number, database: DeckDB = db) => submitHighscore('quizHighscore', score, database)
export const getGuessHighscore = (database: DeckDB = db) => getHighscore('guessHighscore', database)
export const submitGuessScore = (score: number, database: DeckDB = db) => submitHighscore('guessHighscore', score, database)

/** Zusammenfassung des letzten erkannten Patches (für den Hinweis auf der Startseite) */
export interface LastPatch {
  at: number
  changed: number
  added: number
  removed?: number
  /** Namen der neuen und entfernten Karten für den Hinweis */
  addedNames?: string[]
  removedNames?: string[]
}

/** Bestwert einer Build-Quiz-Runde (je Hero und Build-Art) */
export interface BuildBest {
  errors: number
  ms: number
  at: number
}

/** Schlüssel der Bestwerte, z. B. "typical:13" */
export function buildBestKey(source: string, heroId: number): string {
  return `${source}:${heroId}`
}

export async function getBuildBests(database: DeckDB = db): Promise<Record<string, BuildBest>> {
  return getMeta<Record<string, BuildBest>>('buildBest', {}, database)
}

/** Besser = weniger Fehlversuche, bei Gleichstand schneller */
export function isBetterBuildResult(result: { errors: number; ms: number }, best: { errors: number; ms: number } | undefined): boolean {
  return !best || result.errors < best.errors || (result.errors === best.errors && result.ms < best.ms)
}

/** Speichert das Ergebnis, wenn es ein neuer Bestwert ist. Gibt true zurück, wenn ja. */
export async function submitBuildResult(key: string, result: { errors: number; ms: number }, database: DeckDB = db): Promise<boolean> {
  return database.transaction('rw', database.meta, async () => {
    const bests = await getBuildBests(database)
    if (!isBetterBuildResult(result, bests[key])) return false
    await setMeta('buildBest', { ...bests, [key]: { errors: result.errors, ms: result.ms, at: Date.now() } }, database)
    return true
  })
}
