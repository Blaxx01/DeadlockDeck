/**
 * Map-Quiz: „Wo ist …?“ (auf die Map tippen) und „Was ist hier?“ (markierte Stelle, 4 Antworten).
 * Beide Seiten zählen gleich; Runden à 10 Fragen.
 */
import { shuffle, type Rng } from '../quiz/options'
import { countKinds, MAP_KIND_ORDER, MAP_KINDS, MAP_QUIZ_GROUPS, nearestPoint, type MapData, type MapGroup, type MapKind, type MapPoint, type MapPos } from './mapData'

export type MapQuestionType = 'where' | 'what'

export const MAP_QUESTION_TYPES: MapQuestionType[] = ['where', 'what']

export const MAP_QUESTION_LABEL: Record<MapQuestionType, string> = { where: 'Wo ist …?', what: 'Was ist hier?' }

export const MAP_ROUND_SIZE = 10
/** „Wo ist …?“ nur für Arten, die es höchstens so oft gibt – sonst träfe man sie zufällig */
export const WHERE_MAX = 20
/** Ein Tipp zählt bis zu diesem Abstand (Anteil der Kartenbreite – etwa ein Fingerbreit) */
export const TAP_TOLERANCE = 0.05

export interface MapQuestion {
  type: MapQuestionType
  kind: MapKind
  prompt: string
  /** „Was ist hier?“: markierte Stelle */
  spot?: MapPos
  /** „Was ist hier?“: die 4 Antworten */
  options?: MapKind[]
  /** Index der richtigen Antwort in `options` */
  answer?: number
}

/** Tipp auf die Map: richtig, wenn ein Objekt dieser Art höchstens TAP_TOLERANCE entfernt ist */
export function checkTap(data: MapData, kind: MapKind, pos: MapPos): { correct: boolean; nearest?: MapPoint; distance?: number } {
  const hit = nearestPoint(data.points.filter(p => p.kind === kind), pos)
  return { correct: !!hit && hit.distance <= TAP_TOLERANCE, nearest: hit?.point, distance: hit?.distance }
}

function whereQuestion(kind: MapKind): MapQuestion {
  return { type: 'where', kind, prompt: `Tippe auf ${MAP_KINDS[kind].accusative}.` }
}

/**
 * „Was ist hier?“: eine Stelle dieser Art; falsch sind andere Arten – bevorzugt aus demselben Bereich, nie eine,
 * die (fast) an derselben Stelle liegt (z. B. Urnen-Spawn und -Abgabe)
 */
function whatQuestion(data: MapData, kind: MapKind, available: readonly MapKind[], rng: Rng): MapQuestion | null {
  const spots = data.points.filter(p => p.kind === kind)
  if (!spots.length) return null
  const spot = spots[Math.floor(rng() * spots.length)]
  const nearby = new Set(data.points.filter(p => Math.hypot(p.x - spot.x, p.y - spot.y) <= TAP_TOLERANCE).map(p => p.kind))
  const group = MAP_KINDS[kind].group
  const candidates = available.filter(k => k !== kind && !nearby.has(k))
  const wrong = [
    ...shuffle(candidates.filter(k => MAP_KINDS[k].group === group), rng),
    ...shuffle(candidates.filter(k => MAP_KINDS[k].group !== group), rng),
  ].slice(0, 3)
  if (wrong.length < 3) return null
  const options = shuffle([kind, ...wrong], rng)
  return { type: 'what', kind, prompt: 'Was ist hier?', spot: { x: spot.x, y: spot.y }, options, answer: options.indexOf(kind) }
}

/**
 * Eine Runde: Fragetypen reihum (gemischt), jede Art möglichst nur einmal – bei wenigen gewählten Bereichen
 * auch öfter (nie zweimal hintereinander). Kisten & Statuen kommen nicht vor.
 */
export function buildMapRound(
  data: MapData,
  groups: readonly MapGroup[],
  types: readonly MapQuestionType[],
  rng: Rng = Math.random,
  size = MAP_ROUND_SIZE,
): MapQuestion[] {
  const counts = countKinds(data)
  const present = (k: MapKind) => (counts.get(k) ?? 0) > 0 && MAP_QUIZ_GROUPS.includes(MAP_KINDS[k].group)
  const all = MAP_KIND_ORDER.filter(present)
  const chosen = all.filter(k => groups.includes(MAP_KINDS[k].group))
  const pools: Record<MapQuestionType, MapKind[]> = {
    where: chosen.filter(k => (counts.get(k) ?? 0) <= WHERE_MAX),
    what: chosen,
  }
  const usable = types.filter(t => pools[t].length > 0)
  if (usable.length === 0) return []

  const questions: MapQuestion[] = []
  const used = new Set<MapKind>()
  let queue: MapQuestionType[] = []
  for (let tries = 0; questions.length < size && tries < size * 20; tries++) {
    if (!queue.length) queue = shuffle(usable, rng)
    const type = queue.shift()!
    const last = questions.at(-1)?.kind
    let fresh = pools[type].filter(k => !used.has(k))
    if (!fresh.length) fresh = pools[type].filter(k => k !== last)
    if (!fresh.length) continue
    const kind = fresh[Math.floor(rng() * fresh.length)]
    // falsche Antworten auch aus nicht gewählten Bereichen, wenn es sonst keine 3 gibt
    const question = type === 'where' ? whereQuestion(kind) : whatQuestion(data, kind, all, rng)
    if (!question) continue
    used.add(kind)
    questions.push(question)
  }
  return questions
}
