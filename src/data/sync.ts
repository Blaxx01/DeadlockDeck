import type { ApiItem } from './apiTypes'
import { db, getMeta, setMeta, type DeckDB } from './db'
import { buildItemCards } from './normalize'

export const API_BASE = 'https://api.deadlock-api.com/v1/assets'
/**
 * Version des gespeicherten Kartenformats. Erhöhen, wenn sich ItemCard ändert:
 * dann werden die Daten beim nächsten Start mit Netz neu aufgebaut.
 * 2: Timings haben ein `kind` (für Cooldown-Fragen im Quiz)
 */
export const DATA_VERSION = 2
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
}

/** Lädt alle Items (englisch + deutsch) und speichert die Karten in IndexedDB. */
export async function syncItems(database: DeckDB = db): Promise<SyncResult> {
  const [english, german] = await Promise.all([
    fetchJson<ApiItem[]>(`${API_BASE}/items?language=english`),
    fetchJson<ApiItem[]>(`${API_BASE}/items?language=german`).catch(() => [] as ApiItem[]),
  ])
  const cards = buildItemCards(english, german)
  if (cards.length === 0) throw new Error('Die API hat keine Items geliefert.')
  await database.transaction('rw', database.items, database.meta, async () => {
    await database.items.clear()
    await database.items.bulkPut(cards)
    await setMeta('lastSync', Date.now(), database)
    await setMeta('dataVersion', DATA_VERSION, database)
  })
  return { itemCount: cards.length }
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
