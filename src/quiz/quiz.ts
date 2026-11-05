import type { ItemCard, QuizKind } from '../data/model'

export type Rng = () => number

export interface QuizQuestion {
  kind: QuizKind
  /** Karte, um die es geht (für Auflösung und Fehlerliste) */
  itemId: string
  prompt: string
  /** Bild-Frage: das Item-Bild */
  image?: string
  /** Beschreibungs-Frage: Effekttext (HTML, Name geschwärzt; vor Anzeige sanitisieren) */
  html?: string
  /** Zahlen-/Build-Frage: das Item, nach dem gefragt wird (Bild + Name werden gezeigt) */
  subjectId?: string
  options: string[]
  /** Index der richtigen Antwort in `options` */
  answer: number
}

export const ROUND_SIZE = 10
export const BASE_POINTS = 100
export const MAX_SPEED_BONUS = 50
/** Innerhalb dieser Zeit gibt es Zeitbonus (linear fallend) */
export const SPEED_WINDOW_MS = 15_000

export function scoreAnswer(correct: boolean, elapsedMs: number): number {
  if (!correct) return 0
  const bonus = MAX_SPEED_BONUS * Math.max(0, 1 - elapsedMs / SPEED_WINDOW_MS)
  return BASE_POINTS + Math.round(bonus)
}

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Je kleiner, desto ähnlicher: gleiche Kategorie, ähnliches Tier und ähnliche Kosten. */
export function distance(a: ItemCard, b: ItemCard): number {
  const costA = Math.max(a.cost, 1)
  const costB = Math.max(b.cost, 1)
  return (a.slot === b.slot ? 0 : 3) + Math.abs(a.tier - b.tier) * 1.5 + Math.abs(Math.log2(costA / costB))
}

/**
 * Wählt `n` möglichst ähnliche Items mit unterschiedlichen Namen als falsche Antworten.
 * Etwas Zufall sorgt dafür, dass nicht immer dieselben Distraktoren kommen.
 */
export function pickSimilar(
  target: ItemCard,
  pool: readonly ItemCard[],
  n: number,
  rng: Rng,
  excludeNames: Iterable<string> = [],
): ItemCard[] {
  const seen = new Set<string>([target.name, ...excludeNames])
  const ranked = pool
    .filter(c => !seen.has(c.name))
    .map(c => ({ c, d: distance(target, c) + rng() * 1.5 }))
    .sort((x, y) => x.d - y.d)
  const out: ItemCard[] = []
  for (const { c } of ranked) {
    if (seen.has(c.name)) continue
    seen.add(c.name)
    out.push(c)
    if (out.length === n) break
  }
  return out
}

/** Mischt richtige + 3 falsche Antworten. null, wenn es keine 3 verschiedenen falschen gibt. */
export function makeOptions(correct: string, distractors: readonly string[], rng: Rng): { options: string[]; answer: number } | null {
  const unique = [...new Set(distractors.filter(d => d !== correct))]
  if (unique.length < 3) return null
  const options = shuffle([correct, ...unique.slice(0, 3)], rng)
  return { options, answer: options.indexOf(correct) }
}

/** Ersetzt den Item-Namen im Text, damit die Beschreibung die Antwort nicht verrät. */
export function redactName(html: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return html.replace(new RegExp(escaped, 'gi'), '…')
}

/** Effekttext eines Items (geschwärzt) – oder undefined, wenn es keinen sinnvollen gibt. */
export function descriptionOf(item: ItemCard): string | undefined {
  const html = item.sections.map(s => s.html).filter(Boolean).join('<br>')
  const text = html.replace(/<[^>]*>/g, '').trim()
  if (text.length < 20) return undefined
  return redactName(html, item.name)
}

type Generator = (item: ItemCard, pool: readonly ItemCard[], rng: Rng) => QuizQuestion | null

const imageQuestion: Generator = (item, pool, rng) => {
  if (!item.image) return null
  const opts = makeOptions(item.name, pickSimilar(item, pool, 3, rng).map(c => c.name), rng)
  if (!opts) return null
  return { kind: 'image', itemId: item.id, prompt: 'Welches Item ist das?', image: item.image, ...opts }
}

const descriptionQuestion: Generator = (item, pool, rng) => {
  const html = descriptionOf(item)
  if (!html) return null
  // Items mit exakt gleichem Effekttext wären ebenfalls richtig → nicht als falsche Antwort
  const sameText = pool.filter(c => c.name !== item.name && descriptionOf(c) === html).map(c => c.name)
  const opts = makeOptions(item.name, pickSimilar(item, pool, 3, rng, sameText).map(c => c.name), rng)
  if (!opts) return null
  return { kind: 'description', itemId: item.id, prompt: 'Welches Item hat diesen Effekt?', html, ...opts }
}

/** Wählt `n` andere Werte, die nah am richtigen liegen (mit etwas Zufall). */
function nearbyValues(correct: number, values: Iterable<number>, n: number, rng: Rng): number[] {
  const others = [...new Set(values)].filter(v => v !== correct && v > 0)
  return others
    .map(v => ({ v, d: Math.abs(Math.log2(v / correct)) + rng() * 0.5 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map(x => x.v)
}

function costQuestion(item: ItemCard, pool: readonly ItemCard[], rng: Rng): QuizQuestion | null {
  if (!item.cost) return null
  const fmt = (v: number) => `${v.toLocaleString('de-DE')} Souls`
  const others = nearbyValues(item.cost, pool.map(c => c.cost), 3, rng)
  const opts = makeOptions(fmt(item.cost), others.map(fmt), rng)
  if (!opts) return null
  return { kind: 'number', itemId: item.id, subjectId: item.id, prompt: `Wie viel kostet ${item.name}?`, ...opts }
}

function tierQuestion(item: ItemCard, pool: readonly ItemCard[], rng: Rng): QuizQuestion | null {
  const tiers = new Set([1, 2, 3, 4, ...pool.map(c => c.tier)])
  const others = shuffle([...tiers].filter(t => t !== item.tier), rng)
  const opts = makeOptions(`Tier ${item.tier}`, others.map(t => `Tier ${t}`), rng)
  if (!opts) return null
  return { kind: 'number', itemId: item.id, subjectId: item.id, prompt: `Welches Tier hat ${item.name}?`, ...opts }
}

function cooldownOf(item: ItemCard): { value: string; num: number } | undefined {
  const t = item.timings.find(x => x.kind === 'cooldown')
  const num = t ? Number.parseFloat(t.value) : Number.NaN
  return t && Number.isFinite(num) && num > 0 ? { value: t.value, num } : undefined
}

function cooldownQuestion(item: ItemCard, pool: readonly ItemCard[], rng: Rng): QuizQuestion | null {
  const own = cooldownOf(item)
  if (!own) return null
  // Werte als Text vergleichen ("60s"), damit die Einheit stimmt; Nähe über die Zahl
  const byNum = new Map<number, string>()
  for (const c of pool) {
    const cd = cooldownOf(c)
    if (cd && cd.value !== own.value && !byNum.has(cd.num)) byNum.set(cd.num, cd.value)
  }
  const others = nearbyValues(own.num, byNum.keys(), 3, rng).map(n => byNum.get(n)!)
  const opts = makeOptions(own.value, others, rng)
  if (!opts) return null
  return { kind: 'number', itemId: item.id, subjectId: item.id, prompt: `Welchen Cooldown hat ${item.name}?`, ...opts }
}

const numberQuestion: Generator = (item, pool, rng) => {
  // Kosten folgen direkt aus dem Tier – beide zusammen sollen nicht öfter kommen als Cooldown
  const costOrTier = shuffle([costQuestion, tierQuestion], rng)
  const order = rng() < 0.5 ? [cooldownQuestion, ...costOrTier] : [...costOrTier, cooldownQuestion]
  for (const make of order) {
    const q = make(item, pool, rng)
    if (q) return q
  }
  return null
}

const buildQuestion: Generator = (item, pool, rng) => {
  const byName = new Map(pool.map(c => [c.name, c]))
  for (const dir of shuffle(['up', 'down'] as const, rng)) {
    const valid = (dir === 'up' ? item.upgradesTo : item.buildsFrom).filter(n => byName.has(n))
    if (!valid.length) continue
    const correct = byName.get(valid[Math.floor(rng() * valid.length)])!
    // Alle anderen gültigen Antworten ausschließen, sonst gäbe es zwei richtige
    const exclude = [item.name, ...item.upgradesTo, ...item.buildsFrom]
    const opts = makeOptions(correct.name, pickSimilar(correct, pool, 3, rng, exclude).map(c => c.name), rng)
    if (!opts) continue
    const prompt = dir === 'up' ? `In welches Item upgradet ${item.name}?` : `Auf welchem Item baut ${item.name} auf?`
    return { kind: 'build', itemId: item.id, subjectId: item.id, prompt, ...opts }
  }
  return null
}

const GENERATORS: Record<QuizKind, Generator> = {
  image: imageQuestion,
  description: descriptionQuestion,
  number: numberQuestion,
  build: buildQuestion,
}

export function makeQuestion(kind: QuizKind, item: ItemCard, pool: readonly ItemCard[], rng: Rng = Math.random): QuizQuestion | null {
  return GENERATORS[kind](item, pool, rng)
}

/**
 * Baut eine Runde: Fragetypen gemischt (reihum in zufälliger Reihenfolge),
 * jedes Item höchstens einmal. Kann kürzer sein, wenn es zu wenige passende Items gibt.
 */
export function buildRound(
  cards: readonly ItemCard[],
  kinds: readonly QuizKind[],
  rng: Rng = Math.random,
  size = ROUND_SIZE,
): QuizQuestion[] {
  if (cards.length < 4 || kinds.length === 0) return []
  const questions: QuizQuestion[] = []
  const used = new Set<string>()
  const exhausted = new Set<QuizKind>()
  let queue: QuizKind[] = []
  while (questions.length < size && exhausted.size < kinds.length) {
    if (!queue.length) queue = shuffle(kinds.filter(k => !exhausted.has(k)), rng)
    const kind = queue.shift()!
    let question: QuizQuestion | null = null
    for (const item of shuffle(cards.filter(c => !used.has(c.id)), rng)) {
      question = makeQuestion(kind, item, cards, rng)
      if (question) break
    }
    if (!question) {
      exhausted.add(kind)
      continue
    }
    used.add(question.itemId)
    questions.push(question)
  }
  return questions
}
