import { State } from 'ts-fsrs'
import type { ApiGenericData, ApiHero, ApiItem } from './apiTypes'
import { db, getMeta, setMeta, type DeckDB, type LastPatch } from './db'
import { buildHeroDecks } from './heroes'
import { buildItemCards } from './normalize'
import { cardLabel, detectChanges, detectRemoved, type AnyCard } from './patches'
import { parseRanks, type ApiRank } from '../game/ranks'

export const API_BASE = 'https://api.deadlock-api.com/v1/assets'
/**
 * Version des gespeicherten Kartenformats. Erhöhen, wenn sich ItemCard ändert:
 * dann werden die Daten beim nächsten Start mit Netz neu aufgebaut.
 * 2: Timings haben ein `kind` (für Cooldown-Fragen im Quiz)
 * 3: Broker-Variante (`corrupted`) für den Shop
 * 4: Hero-Decks (heroes, abilities) + Einheiten-Korrekturen
 * 5: Hero-Posen fürs Hero-Erraten
 * 6: Fingerprints der Spielwerte (Patch-Erkennung) – der erste Sync misst nur ein
 * 7: Numerische Item-IDs der API (`apiId`) für die Counter-Statistiken
 */
export const DATA_VERSION = 7
/** Nach so vielen Stunden wird bei Netz automatisch neu geladen. */
const AUTO_SYNC_AFTER_HOURS = 24

export async function fetchJson<T>(url: string, timeoutMs = 20000): Promise<T> {
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
  /** Im Sync erkannte Patch-Änderungen (geändert + neu + entfernt) */
  patchChanges: number
}

/**
 * Schutz vor unvollständigen API-Daten: Fehlen plötzlich mehr als 30 % eines Decks, ist das
 * eher eine Panne als ein Patch – dann den alten Stand behalten statt „40 entfernt“ zu melden.
 */
export function assertPlausible(oldCount: number, newCount: number, label: string): void {
  if (oldCount >= 20 && newCount < oldCount * 0.7) {
    throw new Error(`Die API hat deutlich weniger ${label} geliefert als bisher (${newCount} statt ${oldCount}) – Aktualisierung übersprungen, alter Stand bleibt.`)
  }
}

/** Lädt alle Items (englisch + deutsch) und speichert die Karten in IndexedDB. */
export async function syncItems(database: DeckDB = db): Promise<SyncResult> {
  const [english, german, generic, heroesEn, heroesDe, ranks] = await Promise.all([
    fetchJson<ApiItem[]>(`${API_BASE}/items?language=english`),
    fetchJson<ApiItem[]>(`${API_BASE}/items?language=german`).catch(() => [] as ApiItem[]),
    // Broker-Nachteile und Corrupted-Preise – ohne sie fehlen nur diese Angaben
    fetchJson<ApiGenericData>(`${API_BASE}/generic-data`).catch(() => undefined),
    fetchJson<ApiHero[]>(`${API_BASE}/heroes?language=english`),
    fetchJson<ApiHero[]>(`${API_BASE}/heroes?language=german`).catch(() => [] as ApiHero[]),
    // Rang-Namen und -Abzeichen für Souls & Rang – ohne sie bleiben die alten (oder die Standardnamen)
    fetchJson<ApiRank[]>(`${API_BASE}/ranks?language=german`).catch(() => undefined),
  ])
  const cards = buildItemCards(english, german, generic)
  if (cards.length === 0) throw new Error('Die API hat keine Items geliefert.')
  const { heroes, abilities } = buildHeroDecks(heroesEn, heroesDe, english, german)
  const now = Date.now()
  let patchChanges = 0
  const tables = [database.items, database.heroes, database.abilities, database.patches, database.reviews, database.meta]
  await database.transaction('rw', tables, async () => {
    // Patch-Erkennung: alte Karten mit den neuen vergleichen, bevor sie ersetzt werden
    const decks: [AnyCard[], AnyCard[], string][] = [
      [await database.items.toArray(), cards, 'Items'],
      [await database.abilities.toArray(), abilities, 'Fähigkeiten'],
      [await database.heroes.toArray(), heroes, 'Heroes'],
    ]
    for (const [before, after, label] of decks) assertPlausible(before.length, after.length, label)
    const records = decks.flatMap(([before, after]) => detectChanges(before, after, now))
    const removed = decks.flatMap(([before, after]) => detectRemoved(before, after))
    if (records.length || removed.length) {
      const newById = new Map<string, AnyCard>([...cards, ...abilities, ...heroes].map(c => [c.id, c]))
      await database.patches.bulkPut(records)
      // Einträge entfernter Karten aufräumen (der Lernstand bleibt, falls die Karte zurückkommt)
      await database.patches.bulkDelete(removed.map(c => c.id))
      // Schon gelernte, geänderte Karten kommen sofort wieder dran (Lernverlauf bleibt)
      for (const r of records) {
        if (r.kind !== 'changed') continue
        const review = await database.reviews.get(r.id)
        if (review && review.state !== State.New && review.due.getTime() > now) {
          await database.reviews.put({ ...review, due: new Date(now) })
        }
      }
      const added = records.filter(r => r.kind === 'added')
      const summary: LastPatch = {
        at: now,
        changed: records.length - added.length,
        added: added.length,
        removed: removed.length,
        addedNames: added.map(r => newById.get(r.id)).filter((c): c is AnyCard => !!c).map(cardLabel),
        removedNames: removed.map(cardLabel),
      }
      await setMeta('lastPatch', summary, database)
      patchChanges = records.length + removed.length
    }
    await database.items.clear()
    await database.items.bulkPut(cards)
    await database.heroes.clear()
    await database.heroes.bulkPut(heroes)
    await database.abilities.clear()
    await database.abilities.bulkPut(abilities)
    if (ranks?.length) await setMeta('ranks', parseRanks(ranks), database)
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
