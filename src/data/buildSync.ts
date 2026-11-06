/** Lädt die Builds fürs Build-Quiz (Statistik der Deadlock-API) und speichert sie – siehe builds.ts */
import { ANALYTICS_BASE } from './counterSync'
import { COUNTER_MIN_BADGE, type ApiItemStat } from './counters'
import {
  buildCommunityRecord, computeTypicalBuilds, pickTopBuild, type ApiBuild, type ApiHeroBuildStat, type ApiHeroStat,
} from './builds'
import { db, getMeta, setMeta, type DeckDB } from './db'
import type { BuildRecord, HeroCard, ItemCard } from './model'
import { fetchJson } from './sync'

export const BUILDS_BASE = 'https://api.deadlock-api.com/v1/builds'
/** Builds höchstens so oft neu laden */
export const BUILDS_REFRESH_DAYS = 7
/** Version der Berechnung: ändert sie sich, wird neu geladen */
export const BUILDS_VERSION = 1
/** Community-Builds: so viele Heroes gleichzeitig abfragen (schont die API) */
const PARALLEL_HEROES = 4

const DAY = 86_400_000

export async function buildsDue(database: DeckDB = db, now = Date.now()): Promise<boolean> {
  if ((await getMeta<number>('buildsVersion', 0, database)) !== BUILDS_VERSION) return true
  return now - (await getMeta<number>('buildsSync', 0, database)) > BUILDS_REFRESH_DAYS * DAY
}

export interface BuildSyncResult {
  updated: boolean
  typical: number
  community: number
}

const NOT_UPDATED: BuildSyncResult = { updated: false, typical: 0, community: 0 }

/** Führt `task` für alle Einträge aus, höchstens `limit` gleichzeitig */
async function forEachLimited<T>(list: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  const queue = [...list]
  async function worker() {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) await task(next)
  }
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker))
}

/** Meistgespielter Community-Build eines Heroes – null, wenn es keinen (mit genug Daten) gibt */
async function loadCommunityBuild(hero: HeroCard, items: readonly ItemCard[], query: string, now: number): Promise<BuildRecord | null> {
  const stats = await fetchJson<ApiHeroBuildStat[]>(`${ANALYTICS_BASE}/hero-build-stats/${hero.heroId}?${query}`, 60_000)
  const top = pickTopBuild(stats)
  if (!top) return null
  const [build] = await fetchJson<ApiBuild[]>(`${BUILDS_BASE}?build_id=${top.buildId}&only_latest=true`, 60_000)
  return build ? buildCommunityRecord(build, hero, top.share, items, now) : null
}

async function loadBuilds(database: DeckDB, force: boolean): Promise<BuildSyncResult> {
  if (!force && !(await buildsDue(database))) return NOT_UPDATED
  const [items, heroes] = await Promise.all([database.items.toArray(), database.heroes.toArray()])
  if (!items.some(i => typeof i.apiId === 'number') || heroes.length === 0) return NOT_UPDATED

  const query = `min_average_badge=${COUNTER_MIN_BADGE}`
  const [rows, heroStats] = await Promise.all([
    fetchJson<ApiItemStat[]>(`${ANALYTICS_BASE}/item-stats?bucket=hero&${query}`, 90_000),
    fetchJson<ApiHeroStat[]>(`${ANALYTICS_BASE}/hero-stats?${query}`, 60_000),
  ])
  const now = Date.now()
  const typical = computeTypicalBuilds(rows, heroStats, items, heroes, now)
  // Schutz vor unvollständigen Antworten: lieber den alten Stand behalten
  if (typical.length < heroes.length * 0.5) {
    throw new Error(`Die API hat zu wenige Build-Daten geliefert (${typical.length} von ${heroes.length} Heroes).`)
  }

  // Community-Builds: zwei Abfragen je Hero; schlägt ein Hero fehl, bleibt sein alter Build
  const community: BuildRecord[] = []
  const failed = new Set<number>()
  await forEachLimited(heroes, PARALLEL_HEROES, async hero => {
    try {
      const record = await loadCommunityBuild(hero, items, query, now)
      if (record) community.push(record)
    } catch {
      failed.add(hero.heroId)
    }
  })

  await database.transaction('rw', [database.builds, database.meta], async () => {
    const keepOld = (await database.builds.where('source').equals('community').toArray()).filter(b => failed.has(b.heroId))
    await database.builds.clear()
    await database.builds.bulkPut([...typical, ...community, ...keepOld])
    await setMeta('buildsSync', now, database)
    await setMeta('buildsVersion', BUILDS_VERSION, database)
    await setMeta('buildsError', null, database)
  })
  return { updated: true, typical: typical.length, community: community.length }
}

let running: Promise<BuildSyncResult> | null = null

/**
 * Lädt die Builds neu, wenn sie älter als eine Woche sind (oder `force`).
 * Bei Fehlern bleibt der alte Stand; der Fehler wird für die Startseite gemerkt.
 */
export function syncBuilds(database: DeckDB = db, { force = false } = {}): Promise<BuildSyncResult> {
  running ??= loadBuilds(database, force)
    .catch(async (e: unknown) => {
      await setMeta('buildsError', e instanceof Error ? e.message : String(e), database)
      throw e
    })
    .finally(() => { running = null })
  return running
}
