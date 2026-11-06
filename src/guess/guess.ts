import type { GuessKind, HeroCard, QuizScope } from '../data/model'
import { shuffle, type Rng } from '../quiz/quiz'

export const GUESS_ROUND_SIZE = 10
export const START_POINTS = 100
export const REVEAL_COST = 20
export const WRONG_GUESS_COST = 15
/** Aufdeck-Stufen 0–3; Stufe 3 = ganz aufgedeckt */
export const MAX_REVEAL = 3

export interface GuessQuestion {
  /** HeroCard.id der richtigen Antwort */
  heroId: string
  kind: GuessKind
  /** Pose für Silhouette/Zoom/Unscharf – und für die Auflösung */
  image?: string
  /** Zoom: Mittelpunkt des Ausschnitts in Prozent */
  focus?: { x: number; y: number }
  /** Fähigkeit → Hero: Abilities in der Reihenfolge, in der sie aufgedeckt werden */
  abilities?: { name: string; image: string }[]
  /** „Gelerntes zuerst“: Hero-Karte noch nicht gelernt (als „Neu“ markiert, ein Fehler zählt nicht als Schwäche) */
  unlearned?: boolean
}

export type GuessAction = 'reveal' | 'joker' | 'wrong'

/** Punkte nach einer Aktion: Aufdecken −20, falscher Tipp −15, Joker halbiert (nie unter 0) */
export function applyAction(points: number, action: GuessAction): number {
  if (action === 'reveal') return Math.max(0, points - REVEAL_COST)
  if (action === 'wrong') return Math.max(0, points - WRONG_GUESS_COST)
  return Math.floor(points / 2)
}

function posesOf(hero: HeroCard): string[] {
  if (hero.poses?.length) return hero.poses
  return hero.image ? [hero.image] : []
}

export function canAsk(hero: HeroCard, kind: GuessKind): boolean {
  if (kind === 'ability') return hero.abilities.filter(a => a.image).length >= 2
  return posesOf(hero).length > 0
}

export function makeGuessQuestion(hero: HeroCard, kind: GuessKind, rng: Rng = Math.random): GuessQuestion | null {
  if (!canAsk(hero, kind)) return null
  const poses = posesOf(hero)
  const image = poses.length ? poses[Math.floor(rng() * poses.length)] : undefined
  if (kind === 'ability') {
    const abilities = hero.abilities.filter(a => a.image).map(a => ({ name: a.name, image: a.image as string }))
    return { heroId: hero.id, kind, image, abilities: shuffle(abilities, rng) }
  }
  if (kind === 'zoom') {
    // Gesicht/Oberkörper liegen meist mittig im oberen Teil der Kartenbilder
    return { heroId: hero.id, kind, image, focus: { x: Math.round(35 + rng() * 30), y: Math.round(30 + rng() * 30) } }
  }
  return { heroId: hero.id, kind, image }
}

/** Welche Heroes gefragt werden: gelernte Hero-Karten zuerst, nur gelernte oder alle */
export interface GuessScope {
  known?: ReadonlySet<string>
  scope?: QuizScope
}

/**
 * Eine Runde: verschiedene Heroes, Varianten reihum in zufälliger Reihenfolge. Geraten wird immer unter allen Heroes;
 * „Gelerntes zuerst“ fragt erst nach gelernten Hero-Karten (dann die anderen, markiert), „Nur Gelerntes“ nur nach ihnen.
 */
export function buildGuessRound(
  heroes: readonly HeroCard[],
  kinds: readonly GuessKind[],
  rng: Rng = Math.random,
  size = GUESS_ROUND_SIZE,
  { known = new Set(), scope = 'all' }: GuessScope = {},
): GuessQuestion[] {
  if (kinds.length === 0 || heroes.length < 4) return []
  const questions: GuessQuestion[] = []
  let queue: GuessKind[] = []
  const mixed = shuffle(heroes, rng)
  const order = scope === 'all' ? mixed
    : scope === 'learned-only' ? mixed.filter(h => known.has(h.id))
      : [...mixed.filter(h => known.has(h.id)), ...mixed.filter(h => !known.has(h.id))]
  for (const hero of order) {
    if (questions.length >= size) break
    if (!queue.length) queue = shuffle(kinds, rng)
    const preferred = queue[0]
    // Passt die geplante Variante nicht zu diesem Hero (z. B. keine Ability-Bilder), eine andere nehmen
    const kind = [preferred, ...kinds.filter(k => k !== preferred)].find(k => canAsk(hero, k))
    if (!kind) continue
    if (kind === preferred) queue.shift()
    const q = makeGuessQuestion(hero, kind, rng)
    if (q) questions.push(scope === 'learned-first' && !known.has(hero.id) ? { ...q, unlearned: true } : q)
  }
  return questions
}

/** Joker: richtige Antwort + 3 andere Heroes (ohne schon falsch getippte), gemischt. */
export function jokerOptions(correctId: string, allIds: readonly string[], rng: Rng = Math.random, exclude: Iterable<string> = []): string[] {
  const skip = new Set([correctId, ...exclude])
  let others = shuffle(allIds.filter(id => !skip.has(id)), rng)
  // Falls zu viele falsch getippt wurden: notfalls auch diese nehmen
  if (others.length < 3) others = [...others, ...shuffle(allIds.filter(id => id !== correctId && !others.includes(id)), rng)]
  return shuffle([correctId, ...others.slice(0, 3)], rng)
}

export interface StageStyle {
  filter?: string
  transform?: string
  transformOrigin?: string
}

const SILHOUETTE = ['brightness(0)', 'brightness(0.16) contrast(1.6)', 'brightness(0.5) saturate(0.35)']
const BLUR = [22, 12, 5]
const ZOOM = [3.4, 2.3, 1.5]

/** Darstellung des Bildes je Aufdeck-Stufe; gelöst oder Stufe 3 = Originalbild. */
export function stageStyle(q: GuessQuestion, level: number, solved: boolean): StageStyle {
  if (solved || level >= MAX_REVEAL) return {}
  if (q.kind === 'silhouette') return { filter: SILHOUETTE[level] }
  if (q.kind === 'blur') return { filter: `blur(${BLUR[level]}px)` }
  if (q.kind === 'zoom' && q.focus) return { transform: `scale(${ZOOM[level]})`, transformOrigin: `${q.focus.x}% ${q.focus.y}%` }
  return {}
}

/** Fähigkeit → Hero: wie viele Ability-Icons sichtbar sind und ob die Namen schon dastehen. */
export function abilityReveal(q: GuessQuestion, level: number, solved: boolean): { count: number; names: boolean } {
  const total = q.abilities?.length ?? 0
  if (solved) return { count: total, names: true }
  return { count: Math.min(total, level + 1), names: level >= MAX_REVEAL }
}
