import Dexie, { type EntityTable } from 'dexie'
import type { Card } from 'ts-fsrs'
import type { DeckId } from '../decks'
import type { PatchRecord } from './patches'
import { GUESS_KINDS, LEGACY_QUIZ_KINDS, QUIZ_KINDS, type AbilityCard, type CounterCard, type GuessKind, type HeroCard, type ItemCard, type QuizKind, type SlotType } from './model'

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
}

export const DEFAULT_SETTINGS: Settings = {
  dailyGoal: 20,
  newPerDay: 10,
  slots: ['weapon', 'vitality', 'spirit'],
  quizKinds: [...QUIZ_KINDS],
  guessKinds: [...GUESS_KINDS],
}

export class DeckDB extends Dexie {
  items!: EntityTable<ItemCard, 'id'>
  heroes!: EntityTable<HeroCard, 'id'>
  abilities!: EntityTable<AbilityCard, 'id'>
  /** Counter-Karten (Statistik der API, wöchentlich neu) */
  counters!: EntityTable<CounterCard, 'id'>
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
