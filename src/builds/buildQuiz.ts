/**
 * Build-Quiz: alle Items eines Builds an ihren Icons erkennen – Icon für Icon,
 * jeder Tipp wird sofort geprüft. Zur Auswahl stehen die Namen des Builds plus 6 ähnliche Extra-Namen.
 */
import type { BuildRecord, ItemCard } from '../data/model'
import { distance, shuffle, type Rng } from '../quiz/quiz'

export const EXTRA_NAMES = 6

export interface BuildRound {
  build: BuildRecord
  /** Items in Anzeige-Reihenfolge (Abschnitt für Abschnitt) */
  order: ItemCard[]
  /** Abschnitt (Index in build.sections) je Item in `order` */
  sectionOf: number[]
  /** Namen zur Auswahl: alle Build-Items + Extra-Items, gemischt */
  options: ItemCard[]
}

export interface BuildProgress {
  /** Index (in `order`) des markierten Icons */
  current: number
  solved: boolean[]
  /** Falsch getippte Items je Icon */
  wrong: string[][]
  /** Fehlversuche insgesamt */
  errors: number
}

/**
 * Baut eine Runde. Items, die es nicht (mehr) gibt, fallen weg. Die Extra-Namen sind Items,
 * die nicht im Build sind und einem Build-Item ähneln (Kategorie, Tier, Kosten) – mit etwas Zufall.
 */
export function makeBuildRound(build: BuildRecord, items: ReadonlyMap<string, ItemCard>, rng: Rng = Math.random): BuildRound | null {
  const order: ItemCard[] = []
  const sectionOf: number[] = []
  build.sections.forEach((section, si) => {
    for (const { itemId } of section.items) {
      const item = items.get(itemId)
      if (!item || order.some(o => o.name === item.name)) continue
      order.push(item)
      sectionOf.push(si)
    }
  })
  if (order.length < 2) return null
  const names = new Set(order.map(i => i.name))
  const ranked = [...items.values()]
    .filter(c => !names.has(c.name))
    .map(c => ({ c, d: Math.min(...order.map(o => distance(o, c))) + rng() * 1.5 }))
    .sort((a, b) => a.d - b.d)
  const extras: ItemCard[] = []
  for (const { c } of ranked) {
    if (names.has(c.name)) continue
    names.add(c.name)
    extras.push(c)
    if (extras.length === EXTRA_NAMES) break
  }
  return { build, order, sectionOf, options: shuffle([...order, ...extras], rng) }
}

export function startProgress(round: BuildRound): BuildProgress {
  return { current: 0, solved: round.order.map(() => false), wrong: round.order.map(() => []), errors: 0 }
}

/** Nächstes offenes Icon nach `from` (im Kreis); -1, wenn alle gelöst sind */
function nextOpen(solved: readonly boolean[], from: number): number {
  for (let step = 1; step <= solved.length; step++) {
    const i = (from + step) % solved.length
    if (!solved[i]) return i
  }
  return -1
}

export interface PickResult {
  progress: BuildProgress
  correct: boolean
  /** Alle Icons gelöst */
  done: boolean
}

/** Name für das markierte Icon gewählt: richtig → gelöst, weiter zum nächsten offenen; falsch → Fehlversuch */
export function pickName(round: BuildRound, progress: BuildProgress, itemId: string): PickResult {
  const i = progress.current
  if (progress.solved[i]) return { progress, correct: false, done: progress.solved.every(Boolean) }
  if (round.order[i].id === itemId) {
    const solved = progress.solved.map((s, k) => s || k === i)
    const next = nextOpen(solved, i)
    return { progress: { ...progress, solved, current: next === -1 ? i : next }, correct: true, done: next === -1 }
  }
  const wrong = progress.wrong.map((w, k) => (k === i && !w.includes(itemId) ? [...w, itemId] : w))
  return { progress: { ...progress, wrong, errors: progress.errors + 1 }, correct: false, done: false }
}

/** Ein anderes offenes Icon antippen = damit weitermachen */
export function selectIcon(progress: BuildProgress, index: number): BuildProgress {
  return progress.solved[index] ? progress : { ...progress, current: index }
}

/** Namen, die noch zur Auswahl stehen: richtig zugeordnete verschwinden, Extra-Namen bleiben */
export function remainingOptions(round: BuildRound, progress: BuildProgress): ItemCard[] {
  const solvedIds = new Set(round.order.filter((_, k) => progress.solved[k]).map(o => o.id))
  return round.options.filter(o => !solvedIds.has(o.id))
}

export interface BuildMistake {
  item: ItemCard
  /** Die falsch getippten Namen */
  picked: ItemCard[]
}

/** Icons, bei denen es Fehlversuche gab – in Build-Reihenfolge */
export function buildMistakes(round: BuildRound, progress: BuildProgress): BuildMistake[] {
  const byId = new Map(round.options.map(o => [o.id, o]))
  return round.order
    .map((item, k) => ({ item, picked: progress.wrong[k].map(id => byId.get(id)).filter((x): x is ItemCard => !!x) }))
    .filter(m => m.picked.length > 0)
}

/** „1:24“ */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
