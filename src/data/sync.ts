import { State } from 'ts-fsrs'
import type { ApiGenericData, ApiHero, ApiItem } from './apiTypes'
import { db, getMeta, setMeta, type DeckDB, type LastPatch } from './db'
import { buildHeroDecks } from './heroes'
import { buildItemCards } from './normalize'
import { detectChanges } from './patches'

export const API_BASE = 'https://api.deadlock-api.com/v1/assets'
/**
 * Version des gespeicherten Kartenformats. Erhöhen, wenn sich ItemCard ändert:
 * dann werden die Daten beim nächsten Start mit Netz neu aufgebaut.
 * 2: Timings haben ein `kind` (für Cooldown-Fragen im Quiz)
 * 3: Broker-Variante (`corrupted`) für den Shop
 * 4: Hero-Decks (heroes, abilities) + Einheiten-Korrekturen
 * 5: Hero-Posen fürs Hero-Erraten
 * 6: Fingerprints der Spielwerte (Patch-Erkennung) – der erste Sync misst nur ein
 */
export const DATA_VERSION = 6
/** Nach so vielen Stunden wird bei Netz automatisch neu geladen. */
const AUTO_SYNC_AFTER_HOURS = 24

async function fetchJson<T>(url: string, timeoutMs = 20000): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export interface SyncResult {
  itemCount: number
  heroCount: number
  abilityCount: number
  /** Im Sync erkannte Patch-Änderungen (geändert + neu) */
  patchChanges: number
}

/** Lädt alle Items (englisch + deutsch) und speichert die Karten in IndexedDB. */
export async function syncItems(database: DeckDB = db): Promise<SyncResult> {
  const [english, german, generic, heroesEn, heroesDe] = await Promise.all([
    fetchJson<ApiItem[]>(`${API_BASE}/items?language=english`),
    fetchJson<ApiItem[]>(`${API_BASE}/items?language=german`).catch(() => [] as ApiItem[]),
    // Broker-Nachteile und Corrupted-Preise – ohne sie fehlen nur diese Angaben
    fetchJson<ApiGenericData>(`${API_BASE}/generic-data`).catch(() => undefined),
    fetchJson<ApiHero[]>(`${API_BASE}/heroes?language=english`),
    fetchJson<ApiHero[]>(`${API_BASE}/heroes?language=german`).catch(() => [] as ApiHero[]),
  ])
  const cards = buildItemCards(english, german, generic)
  if (cards.length === 0) throw new Error('Die API hat keine Items geliefert.')
  const { heroes, abilities } = buildHeroDecks(heroesEn, heroesDe, english, german)
  const now = Date.now()
  let patchChanges = 0
  const tables = [database.items, database.heroes, database.abilities, database.patches, database.reviews, database.meta]
  await database.transaction('rw', tables, async () => {
    // Patch-Erkennung: alte Karten mit den neuen vergleichen, bevor sie ersetzt werden
    const records = [
      ...detectChanges(await database.items.toArray(), cards, now),
      ...detectChanges(await database.abilities.toArray(), abilities, now),
      ...detectChanges(await database.heroes.toArray(), heroes, now),
    ]
    if (records.length) {
      await database.patches.bulkPut(records)
      // Schon gelernte, geänderte Karten kommen sofort wieder dran (Lernverlauf bleibt)
      for (const r of records) {
        if (r.kind !== 'changed') continue
        const review = await database.reviews.get(r.id)
        if (review && review.state !== State.New && review.due.getTime() > now) {
          await database.reviews.put({ ...review, due: new Date(now) })
        }
      }
      const summary: LastPatch = {
        at: now,
        changed: records.filter(r => r.kind === 'changed').length,
        added: records.filter(r => r.kind === 'added').length,
      }
      await setMeta('lastPatch', summary, database)
      patchChanges = records.length
    }
    await database.items.clear()
    await database.items.bulkPut(cards)
    await database.heroes.clear()
    await database.heroes.bulkPut(heroes)
    await database.abilities.clear()
    await database.abilities.bulkPut(abilities)
    await setMeta('lastSync', Date.now(), database)
    await setMeta('dataVersion', DATA_VERSION, database)
  })
  return { itemCount: cards.length, heroCount: heroes.length, abilityCount: abilities.length, patchChanges }
}

export async function needsAutoSync(database: DeckDB = db): Promise<boolean> {
  if ((await getMeta<number>('dataVersion', 1, database)) !== DATA_VERSION) return true
  const last = await getMeta<number>('lastSync', 0, database)
  return Date.now() - last > AUTO_SYNC_AFTER_HOURS * 3600_000
}

/**
 * Lädt alle Bilder einmal, damit der Service Worker sie für offline cached.
 * Erst mit CORS (kleinerer Cache-Eintrag), sonst no-cors (opaque).
 */
export async function prewarmImages(
  urls: string[],
  onProgress?: (done: number, total: number) => void,
  concurrency = 6,
): Promise<{ ok: number; failed: number }> {
  const queue = [...new Set(urls)]
  const total = queue.length
  let done = 0
  let ok = 0
  let failed = 0
  async function worker() {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try {
        const res = await fetch(url, { mode: 'cors' }).catch(() => fetch(url, { mode: 'no-cors' }))
        if (res.ok || res.type === 'opaque') ok++
        else failed++
      } catch {
        failed++
      }
      done++
      onProgress?.(done, total)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker))
  return { ok, failed }
}

/**
 * Wartet, bis der Service Worker die Seite kontrolliert. Erst dann landen
 * Bild-Requests in seinem Cache (wichtig beim allerersten Start).
 */
export function waitForServiceWorker(timeoutMs = 15000): Promise<boolean> {
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined
  if (!sw) return Promise.resolve(false)
  if (sw.controller) return Promise.resolve(true)
  return new Promise(resolve => {
    const onChange = () => {
      clearTimeout(timer)
      resolve(true)
    }
    const timer = setTimeout(() => {
      sw.removeEventListener('controllerchange', onChange)
      resolve(false)
    }, timeoutMs)
    sw.addEventListener('controllerchange', onChange, { once: true })
  })
}
