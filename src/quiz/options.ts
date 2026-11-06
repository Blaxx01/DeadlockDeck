/** Gemeinsame Bausteine für Antwortmöglichkeiten (Quiz, Sprint, Hero erraten) */
import type { ItemCard } from '../data/model'

export type Rng = () => number

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
