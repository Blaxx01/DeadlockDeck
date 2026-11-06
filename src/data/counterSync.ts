/** Lädt die Counter-Daten (Statistik der Deadlock-API) und speichert sie – siehe counters.ts */
import { State } from 'ts-fsrs'
import { computeCounters, COUNTER_MIN_BADGE, detectCounterChanges, type ApiItemStat } from './counters'
import { db, getMeta, setMeta, type DeckDB } from './db'
import { fetchJson } from './sync'

export const ANALYTICS_BASE = 'https://api.deadlock-api.com/v1/analytics'
/** Counter-Daten höchstens so oft neu laden */
export const COUNTER_REFRESH_DAYS = 7
/** Version der Berechnung: ändert sie sich, wird neu geladen und still neu eingemessen */
export const COUNTER_VERSION = 1

const DAY = 86_400_000
/** Die Abfrage nach Gegner-Hero dauert bei der API schon mal 15 s */
const COUNTER_TIMEOUT_MS = 90_000

export async function countersDue(database: DeckDB = db, now = Date.now()): Promise<boolean> {
  if ((await getMeta<number>('countersVersion', 0, database)) !== COUNTER_VERSION) return true
  return now - (await getMeta<number>('countersSync', 0, database)) > COUNTER_REFRESH_DAYS * DAY
}

export interface CounterSyncResult {
  updated: boolean
  heroes: number
  /** Karten mit neuem Top-Counter */
  changed: number
}

const NOT_UPDATED: CounterSyncResult = { updated: false, heroes: 0, changed: 0 }

async function loadCounters(database: DeckDB, force: boolean): Promise<CounterSyncResult> {
  if (!force && !(await countersDue(database))) return NOT_UPDATED
  const [items, heroes] = await Promise.all([database.items.toArray(), database.heroes.toArray()])
  // Item-Daten von vor DATA_VERSION 7 haben noch keine API-IDs → erst der normale Sync
  if (!items.some(i => typeof i.apiId === 'number') || heroes.length === 0) return NOT_UPDATED

  const query = `min_average_badge=${COUNTER_MIN_BADGE}`
  const [byEnemy, base] = await Promise.all([
    fetchJson<ApiItemStat[]>(`${ANALYTICS_BASE}/item-stats?bucket=enemy_hero&${query}`, COUNTER_TIMEOUT_MS),
    fetchJson<ApiItemStat[]>(`${ANALYTICS_BASE}/item-stats?${query}`, COUNTER_TIMEOUT_MS),
  ])
  const now = Date.now()
  const cards = computeCounters(byEnemy, base, items, heroes, now)
  // Schutz vor unvollständigen Antworten: lieber den alten Stand behalten
  if (cards.length < heroes.length * 0.5) {
    throw new Error(`Die API hat zu wenige Counter-Daten geliefert (${cards.length} von ${heroes.length} Heroes).`)
  }
  const names = new Map(items.map(i => [i.id, i.name]))
  const nameOf = (id: string) => names.get(id) ?? id.replace(/^item:(upgrade_)?/, '')
  let changed = 0
  await database.transaction('rw', [database.counters, database.patches, database.reviews, database.meta], async () => {
    // Nach einer neuen Berechnungs-Version nur still neu einmessen
    const sameVersion = (await getMeta<number>('countersVersion', 0, database)) === COUNTER_VERSION
    const records = sameVersion ? detectCounterChanges(await database.counters.toArray(), cards, now, nameOf) : []
    if (records.length) {
      await database.patches.bulkPut(records)
      // Schon gelernte Karten mit neuem Top-Counter kommen sofort wieder dran (Lernverlauf bleibt)
      for (const r of records) {
        const review = await database.reviews.get(r.id)
        if (review && review.state !== State.New && review.due.getTime() > now) {
          await database.reviews.put({ ...review, due: new Date(now) })
        }
      }
    }
    changed = records.length
    await database.counters.clear()
    await database.counters.bulkPut(cards)
    await setMeta('countersSync', now, database)
    await setMeta('countersVersion', COUNTER_VERSION, database)
    await setMeta('countersError', null, database)
  })
  return { updated: true, heroes: cards.length, changed }
}

let running: Promise<CounterSyncResult> | null = null

/**
 * Lädt die Counter-Daten neu, wenn sie älter als eine Woche sind (oder `force`).
 * Bei Fehlern bleibt der alte Stand; der Fehler wird für die Startseite gemerkt.
 */
export function syncCounters(database: DeckDB = db, { force = false } = {}): Promise<CounterSyncResult> {
  running ??= loadCounters(database, force)
    .catch(async (e: unknown) => {
      await setMeta('countersError', e instanceof Error ? e.message : String(e), database)
      throw e
    })
    .finally(() => { running = null })
  return running
}
