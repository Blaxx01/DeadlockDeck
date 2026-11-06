/**
 * Schwächen: Fehler aus allen Modi („nicht gewusst“, Quiz, Hero erraten, Build-Quiz, Sprint, Überleben) der letzten 14 Tage
 * und hartnäckige Karten (mind. 4× vergessen), bis sie wieder sitzen.
 * „Schwächen üben“ zeigt die Karten mit den meisten Fehlern; „gewusst“ im Training behebt die Schwäche.
 */
import { addDays, localDate } from '../data/dates'
import { db, type DeckDB, type ReviewRecord } from '../data/db'
import { atLeast, masteryOf, type Mastery } from './mastery'
import { baseCardId, isReverseId } from '../decks'

export type MistakeSource = 'learn' | 'quiz' | 'guess' | 'build' | 'sprint' | 'survival'

export interface MistakeEntry {
  id: number
  /** Karten-ID, z. B. "item:upgrade_fleetfoot", "hero:hero_haze", "counter:hero_seven" */
  cardId: string
  source: MistakeSource
  at: number
  /** Lokales Datum YYYY-MM-DD */
  date: string
}

export const WEAK_DAYS = 14
export const WEAK_MAX_CARDS = 15

export const MISTAKE_SOURCE_LABEL: Record<MistakeSource, string> = {
  learn: 'nicht gewusst',
  quiz: 'Quiz',
  guess: 'Hero erraten',
  build: 'Build-Quiz',
  sprint: 'Sprint',
  survival: 'Überleben',
}

/** Erster Tag, der noch zählt (heute und die 13 Tage davor) */
export function weakSince(now: Date): string {
  return addDays(localDate(now), -(WEAK_DAYS - 1))
}

export async function logMistake(cardId: string, source: MistakeSource, now = new Date(), database: DeckDB = db): Promise<void> {
  await database.mistakes.add({ cardId, source, at: now.getTime(), date: localDate(now) })
}

/** Innerhalb einer Transaktion über `mistakes` */
export async function logMistakeInTx(database: DeckDB, cardId: string, source: MistakeSource, now: Date): Promise<void> {
  await database.mistakes.add({ cardId, source, at: now.getTime(), date: localDate(now) })
}

/** „Gewusst“ im Training: alle Fehler dieser Karte sind behoben (in Transaktion) */
export async function resolveWeaknessInTx(database: DeckDB, cardId: string): Promise<void> {
  await database.mistakes.where('cardId').equals(cardId).delete()
}

export interface Weakness {
  cardId: string
  count: number
  sources: MistakeSource[]
  /** Letzter Fehler (ms) */
  last: number
  /** Hartnäckige Karte: so oft nach dem Lernen vergessen */
  leech?: number
}

/** Hartnäckig: nach dem Lernen mindestens so oft vergessen (FSRS zählt das als „lapses“) */
export const LEECH_LAPSES = 4
/** Höchstens so viele hartnäckige Karten zusätzlich zu den Schwächen der letzten 14 Tage */
export const WEAK_MAX_LEECHES = 10

export function isLeech(review?: Pick<ReviewRecord, 'lapses'>): boolean {
  return (review?.lapses ?? 0) >= LEECH_LAPSES
}

export interface Leech {
  cardId: string
  lapses: number
  level: Mastery
}

/** Meiste Fehler zuerst, bei Gleichstand der jüngste */
export function rankWeaknesses(entries: readonly MistakeEntry[], since: string): Weakness[] {
  const byCard = new Map<string, Weakness>()
  for (const e of entries) {
    if (e.date < since) continue
    const w = byCard.get(e.cardId) ?? { cardId: e.cardId, count: 0, sources: [], last: 0 }
    w.count++
    if (!w.sources.includes(e.source)) w.sources.push(e.source)
    w.last = Math.max(w.last, e.at)
    byCard.set(e.cardId, w)
  }
  return [...byCard.values()].sort((a, b) => b.count - a.count || b.last - a.last)
}

const CARD_TABLES = { item: 'items', ability: 'abilities', hero: 'heroes', counter: 'counters' } as const

/** Welche der Karten gibt es (noch)? Rückrichtung: wenn es die Vorwärts-Karte gibt */
async function existingCardIds(ids: readonly string[], database: DeckDB): Promise<Set<string>> {
  const found = new Set<string>()
  for (const [prefix, table] of Object.entries(CARD_TABLES)) {
    const wanted = ids.filter(id => id.startsWith(`${prefix}:`))
    if (!wanted.length) continue
    const rows = await database.table(table).bulkGet(wanted.map(baseCardId))
    rows.forEach((row, i) => { if (row) found.add(wanted[i]) })
  }
  return found
}

/** Alle hartnäckigen Karten (auch die, die wieder sitzen), am häufigsten vergessen zuerst – nur Karten, die es noch gibt */
export async function getLeeches(database: DeckDB = db): Promise<Leech[]> {
  const reviews = await database.reviews.filter(r => isLeech(r)).toArray()
  const exists = await existingCardIds(reviews.map(r => r.id), database)
  return reviews
    .filter(r => exists.has(r.id))
    .map(r => ({ cardId: r.id, lapses: r.lapses, level: masteryOf(r) }))
    .sort((a, b) => b.lapses - a.lapses || a.cardId.localeCompare(b.cardId))
}

/**
 * Schwächen der letzten 14 Tage (die `limit` mit den meisten Fehlern, nur Karten, die es noch gibt) – dazu
 * hartnäckige Karten, die noch nicht wieder sitzen (Silber), auch ohne Fehler in den letzten 14 Tagen.
 */
export async function getWeaknesses(now = new Date(), database: DeckDB = db, limit = WEAK_MAX_CARDS): Promise<Weakness[]> {
  const since = weakSince(now)
  const ranked = rankWeaknesses(await database.mistakes.where('date').aboveOrEqual(since).toArray(), since)
  const exists = await existingCardIds(ranked.map(w => w.cardId), database)
  const leeches = (await getLeeches(database)).filter(l => !atLeast(l.level, 'silver'))
  const lapses = new Map(leeches.map(l => [l.cardId, l.lapses]))
  const marked = ranked.filter(w => exists.has(w.cardId)).map(w => (lapses.has(w.cardId) ? { ...w, leech: lapses.get(w.cardId) } : w))
  const top = marked.slice(0, limit)
  const shown = new Set(top.map(w => w.cardId))
  const recent = new Map(marked.map(w => [w.cardId, w]))
  const extra = leeches
    .filter(l => !shown.has(l.cardId))
    .slice(0, WEAK_MAX_LEECHES)
    .map(l => recent.get(l.cardId) ?? { cardId: l.cardId, count: 0, sources: [], last: 0, leech: l.lapses })
  return [...top, ...extra]
}

/** Verschiedene Karten mit Fehlern in den letzten 14 Tagen (schnell, ohne Prüfung) – für die Missionen */
export async function weakCardCount(now = new Date(), database: DeckDB = db): Promise<number> {
  const entries = await database.mistakes.where('date').aboveOrEqual(weakSince(now)).toArray()
  return new Set(entries.map(e => e.cardId)).size
}

/** Fehler, die älter als 14 Tage sind, löschen */
export async function pruneMistakes(now = new Date(), database: DeckDB = db): Promise<number> {
  return database.mistakes.where('date').below(weakSince(now)).delete()
}

export interface CardInfo {
  label: string
  image?: string
  /** z. B. „Item“, „Fähigkeit“ */
  kind: string
}

/** Name und Bild einer Karte für die Übersicht (Rückrichtung: „Name (Rückrichtung)“) */
export async function describeCards(ids: readonly string[], database: DeckDB = db): Promise<Map<string, CardInfo>> {
  const base = await describeBaseCards([...new Set(ids.map(baseCardId))], database)
  const out = new Map<string, CardInfo>()
  for (const id of ids) {
    const info = base.get(baseCardId(id))
    if (info) out.set(id, isReverseId(id) ? { ...info, label: `${info.label} (Rückrichtung)` } : info)
  }
  return out
}

async function describeBaseCards(ids: readonly string[], database: DeckDB): Promise<Map<string, CardInfo>> {
  const out = new Map<string, CardInfo>()
  const of = (prefix: string) => ids.filter(id => id.startsWith(`${prefix}:`))
  const [items, abilities, heroes, counters] = await Promise.all([
    database.items.bulkGet(of('item')),
    database.abilities.bulkGet(of('ability')),
    database.heroes.bulkGet(of('hero')),
    database.counters.bulkGet(of('counter')),
  ])
  for (const c of items) if (c) out.set(c.id, { label: c.name, image: c.image, kind: 'Item' })
  for (const c of abilities) if (c) out.set(c.id, { label: `${c.name} (${c.heroName})`, image: c.image, kind: 'Fähigkeit' })
  for (const c of heroes) if (c) out.set(c.id, { label: c.name, image: c.smallImage ?? c.image, kind: 'Hero' })
  for (const c of counters) if (c) out.set(c.id, { label: `Counter gegen ${c.heroName}`, image: c.smallImage ?? c.image, kind: 'Counter' })
  return out
}
