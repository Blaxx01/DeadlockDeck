import { formatFactor, isClearCounter, NO_COUNTER } from '../data/counters'
import type { AbilityCard, CounterCard, ItemCard, QuizKind } from '../data/model'
import { buildEffectIndex, effectQuestion, type EffectIndex } from './effects'
import { distance, makeOptions, pickSimilar, shuffle, type Rng } from './options'
import { nextUpgradeQuestion } from './upgrades'

export type { Rng } from './options'
export { distance, makeOptions, pickSimilar, shuffle } from './options'

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
  /** Counter-Fragen: der Hero, um den es geht (jeder Hero höchstens einmal pro Runde) */
  heroId?: number
  /** Counter Hero → Item: Porträt des Heroes */
  portrait?: string
  /** Counter Item → Hero: Hero-Icons zu den Antworten */
  optionImages?: (string | undefined)[]
  /** Auflösung nach der Antwort (statt der Item-Infos) */
  info?: string
  /** Karte, die bei einer falschen Antwort als Schwäche zählt (Standard: das Item) */
  cardId?: string
  /** Upgrade-Frage: Zeile unter dem Icon, z. B. „Fähigkeit von Haze“ */
  caption?: string
  /** Effekt-Frage: der Wert, um den es geht (groß angezeigt) */
  subjectText?: string
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

/** Was die Fragegeneratoren brauchen */
export interface QuizContext {
  /** Items, aus denen gefragt wird (Kategorie-Filter) – auch die falschen Antworten */
  pool: readonly ItemCard[]
  /** Counter-Karten (für die Counter-Fragen) */
  counters: readonly CounterCard[]
  /** Alle Items (Karten-ID → Karte), auch außerhalb des Filters – für die Auflösung */
  items: ReadonlyMap<string, ItemCard>
  /** Items, die gegen mindestens einen Hero ein klarer Counter sind */
  counterItems: ReadonlySet<string>
  /** Heroes, nach denen in dieser Runde schon gefragt wurde */
  usedHeroes: ReadonlySet<number>
  /** Fähigkeiten (Upgrade-Fragen) */
  abilities: readonly AbilityCard[]
  /** Fähigkeiten mit gelernter Karte – kommen bei Upgrade-Fragen bevorzugt dran */
  learnedAbilities: ReadonlySet<string>
  /** Werte der Items (Effekt-Fragen) */
  effects: EffectIndex
}

/** Was eine Runde außer den Items braucht */
export interface QuizExtra {
  counters?: readonly CounterCard[]
  /** Alle Items, auch außerhalb des Kategorie-Filters – für die Auflösung */
  items?: ReadonlyMap<string, ItemCard>
  abilities?: readonly AbilityCard[]
  /** IDs der Fähigkeiten-Karten, die schon gelernt sind */
  learnedAbilities?: ReadonlySet<string>
}

export function quizContext(pool: readonly ItemCard[], { counters = [], items, abilities = [], learnedAbilities = new Set() }: QuizExtra = {}): QuizContext {
  const counterItems = new Set(counters.flatMap(c => Object.keys(c.factors).filter(id => isClearCounter(c.factors[id]))))
  return {
    pool, counters, items: items ?? new Map(pool.map(i => [i.id, i])), counterItems, usedHeroes: new Set(),
    abilities, learnedAbilities, effects: buildEffectIndex(pool),
  }
}

type Generator = (item: ItemCard, ctx: QuizContext, rng: Rng) => QuizQuestion | null

const imageQuestion: Generator = (item, { pool }, rng) => {
  if (!item.image) return null
  const opts = makeOptions(item.name, pickSimilar(item, pool, 3, rng).map(c => c.name), rng)
  if (!opts) return null
  return { kind: 'image', itemId: item.id, prompt: 'Welches Item ist das?', image: item.image, ...opts }
}

const descriptionQuestion: Generator = (item, { pool }, rng) => {
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

const numberQuestion: Generator = (item, { pool }, rng) => {
  // Kosten folgen direkt aus dem Tier – beide zusammen sollen nicht öfter kommen als Cooldown
  const costOrTier = shuffle([costQuestion, tierQuestion], rng)
  const order = rng() < 0.5 ? [cooldownQuestion, ...costOrTier] : [...costOrTier, cooldownQuestion]
  for (const make of order) {
    const q = make(item, pool, rng)
    if (q) return q
  }
  return null
}

const buildQuestion: Generator = (item, { pool }, rng) => {
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

/** Heroes, gegen die ein Item ein klarer Counter ist – stärkster zuerst */
function heroesCounteredBy(itemId: string, counters: readonly CounterCard[]): CounterCard[] {
  return counters.filter(c => isClearCounter(c.factors[itemId])).sort((a, b) => b.factors[itemId] - a.factors[itemId])
}

/** Kein Counter: Faktor bekannt und höchstens 1,0× (zu wenig Daten zählt nicht als „kein Counter“) */
function isNoCounter(card: CounterCard, itemId: string): boolean {
  return (card.factors[itemId] ?? Number.POSITIVE_INFINITY) <= NO_COUNTER
}

/** „Metal Skin 2,1× · Return Fire 1,4×“ – die klaren Counter eines Heroes */
function clearCountersText(card: CounterCard, items: ReadonlyMap<string, ItemCard>, max = 4): string {
  return Object.entries(card.factors)
    .filter(([, f]) => isClearCounter(f))
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([id, f]) => `${items.get(id)?.name ?? id} ${formatFactor(f)}`)
    .join(' · ')
}

/** Hero → Item: „Welches Item wird gegen Vindicta besonders oft gekauft?“ (richtig: dieses Item) */
const counterItemQuestion: Generator = (item, ctx, rng) => {
  const heroes = heroesCounteredBy(item.id, ctx.counters).filter(c => !ctx.usedHeroes.has(c.heroId))
  if (!heroes.length) return null
  const hero = heroes[Math.floor(rng() * heroes.length)]
  // Falsch: gegen diesen Hero kein Counter – bevorzugt Items, die gegen andere Heroes Counter sind
  const distractors = ctx.pool
    .filter(c => c.name !== item.name && isNoCounter(hero, c.id))
    .map(c => ({ c, d: (ctx.counterItems.has(c.id) ? 0 : 2) + distance(item, c) * 0.5 + rng() * 1.5 }))
    .sort((a, b) => a.d - b.d)
    .map(x => x.c.name)
  const opts = makeOptions(item.name, distractors, rng)
  if (!opts) return null
  return {
    kind: 'counterItem',
    itemId: item.id,
    cardId: hero.id,
    heroId: hero.heroId,
    portrait: hero.image,
    prompt: `Welches Item wird gegen ${hero.heroName} besonders oft gekauft?`,
    info: `Klare Counter gegen ${hero.heroName}: ${clearCountersText(hero, ctx.items)}`,
    ...opts,
  }
}

/** Item → Hero: „Gegen welchen Hero wird Spellbreaker besonders oft gekauft?“ */
const counterHeroQuestion: Generator = (item, ctx, rng) => {
  const countered = heroesCounteredBy(item.id, ctx.counters)
  const candidates = countered.filter(c => !ctx.usedHeroes.has(c.heroId))
  if (!candidates.length) return null
  const hero = candidates[Math.floor(rng() * candidates.length)]
  // Falsch: Heroes, gegen die das Item kein Counter ist – bevorzugt solche mit klaren Countern derselben Kategorie
  const sameSlot = (c: CounterCard) => Object.entries(c.factors).some(([id, f]) => isClearCounter(f) && ctx.items.get(id)?.slot === item.slot)
  const others = ctx.counters
    .filter(c => c.heroId !== hero.heroId && isNoCounter(c, item.id))
    .map(c => ({ c, d: (sameSlot(c) ? 0 : 1) + rng() * 1.2 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map(x => x.c)
  if (others.length < 3) return null
  const options = shuffle([hero, ...others], rng)
  return {
    kind: 'counterHero',
    itemId: item.id,
    subjectId: item.id,
    cardId: hero.id,
    heroId: hero.heroId,
    prompt: `Gegen welchen Hero wird ${item.name} besonders oft gekauft?`,
    options: options.map(o => o.heroName),
    optionImages: options.map(o => o.smallImage ?? o.image),
    answer: options.indexOf(hero),
    info: `${item.name} wird besonders oft gekauft gegen: ${countered.slice(0, 4).map(c => `${c.heroName} ${formatFactor(c.factors[item.id])}`).join(' · ')}`,
  }
}

/** Effekt → Item oder „Wer gibt am meisten?“ */
const effectItemQuestion: Generator = (item, ctx, rng) => effectQuestion(item, ctx.pool, ctx.effects, rng)

/** Fragetypen, die von einem Item ausgehen (Upgrade-Fragen gehen von einer Fähigkeit aus) */
export type ItemQuizKind = Exclude<QuizKind, 'upgrade'>

const GENERATORS: Record<ItemQuizKind, Generator> = {
  image: imageQuestion,
  description: descriptionQuestion,
  number: numberQuestion,
  build: buildQuestion,
  counterItem: counterItemQuestion,
  counterHero: counterHeroQuestion,
  effect: effectItemQuestion,
}

export function makeQuestion(
  kind: ItemQuizKind,
  item: ItemCard,
  pool: readonly ItemCard[],
  rng: Rng = Math.random,
  ctx: QuizContext = quizContext(pool),
): QuizQuestion | null {
  return GENERATORS[kind](item, ctx, rng)
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
  extra: QuizExtra = {},
): QuizQuestion[] {
  if (cards.length < 4 || kinds.length === 0) return []
  const questions: QuizQuestion[] = []
  const used = new Set<string>()
  const usedHeroes = new Set<number>()
  const ctx: QuizContext = { ...quizContext(cards, extra), usedHeroes }
  const exhausted = new Set<QuizKind>()
  let queue: QuizKind[] = []
  while (questions.length < size && exhausted.size < kinds.length) {
    if (!queue.length) queue = shuffle(kinds.filter(k => !exhausted.has(k)), rng)
    const kind = queue.shift()!
    let question: QuizQuestion | null = null
    if (kind === 'upgrade') {
      // geht von einer Fähigkeit aus; `used` enthält auch die Fähigkeiten dieser Runde
      question = nextUpgradeQuestion(ctx.abilities, ctx.learnedAbilities, used, rng)
    } else {
      for (const item of shuffle(cards.filter(c => !used.has(c.id)), rng)) {
        question = makeQuestion(kind, item, cards, rng, ctx)
        if (question) break
      }
    }
    if (!question) {
      exhausted.add(kind)
      continue
    }
    used.add(question.itemId)
    if (question.heroId !== undefined) usedHeroes.add(question.heroId)
    questions.push(question)
  }
  return questions
}
