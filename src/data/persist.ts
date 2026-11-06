/**
 * Dauerhafter Speicher: Ohne Zusage darf der Browser die Daten bei Platzmangel löschen.
 * Angefragt wird erst, wenn es Fortschritt gibt, und höchstens einmal am Tag – Firefox fragt dann nach,
 * Chrome entscheidet selbst (z. B. nach der Installation oder bei häufiger Nutzung).
 */
import { localDate } from './dates'
import { db, getMeta, setMeta, type DeckDB } from './db'

export type StorageApi = Pick<StorageManager, 'persist' | 'persisted'>

function storageApi(): StorageApi | undefined {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined
  return storage && typeof storage.persist === 'function' && typeof storage.persisted === 'function' ? storage : undefined
}

/** Ist der Speicher dauerhaft? `undefined`: Der Browser kann es nicht sagen. */
export async function isStoragePersisted(storage: StorageApi | undefined = storageApi()): Promise<boolean | undefined> {
  if (!storage) return undefined
  try {
    return await storage.persisted()
  } catch {
    return undefined
  }
}

/** Dauerhaften Speicher anfragen (mit Fortschritt, höchstens einmal am Tag); Ergebnis wie `isStoragePersisted` */
export async function ensurePersistentStorage(
  now = new Date(),
  database: DeckDB = db,
  storage: StorageApi | undefined = storageApi(),
): Promise<boolean | undefined> {
  if (!storage) return undefined
  try {
    if (await storage.persisted()) return true
    if ((await database.reviews.count()) === 0) return false
    const today = localDate(now)
    if ((await getMeta<string | null>('persistAskedOn', null, database)) === today) return false
    await setMeta('persistAskedOn', today, database)
    return await storage.persist()
  } catch {
    return undefined
  }
}
