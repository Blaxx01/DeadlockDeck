import Dexie, { type EntityTable } from 'dexie'
import type { Card } from 'ts-fsrs'
import type { ItemCard, SlotType } from './model'

export interface ReviewRecord extends Card {
  /** Karten-ID, z. B. "item:upgrade_headshot_booster" */
  id: string
}

export interface DayRecord {
  /** Lokales Datum YYYY-MM-DD */
  date: string
  reviewed: number
  newIntroduced: number
}

export interface MetaRecord {
  key: string
  value: unknown
}

export interface Settings {
  dailyGoal: number
  newPerDay: number
  slots: SlotType[]
}

export const DEFAULT_SETTINGS: Settings = {
  dailyGoal: 20,
  newPerDay: 10,
  slots: ['weapon', 'vitality', 'spirit'],
}

export class DeckDB extends Dexie {
  items!: EntityTable<ItemCard, 'id'>
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
  return { ...DEFAULT_SETTINGS, ...(await getMeta<Partial<Settings>>('settings', {}, database)) }
}

export async function saveSettings(settings: Settings, database: DeckDB = db): Promise<void> {
  await setMeta('settings', settings, database)
}
