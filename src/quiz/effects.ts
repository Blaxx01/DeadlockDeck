/**
 * Fragetyp „Item-Effekte“ (aus den Item-Werten), zwei Varianten:
 * - Effekt → Item: „Welches Item hat „+30 % Kugellebensraub“?“ – genau eine Antwort hat den Effekt
 * - Wer gibt am meisten: „Bonuslebenspunkte – welches Item gibt davon am meisten?“ – alle 4 haben ihn
 */
import type { ItemCard, SectionType } from '../data/model'
import { makeOptions, pickSimilar, shuffle, type Rng } from './options'
import type { QuizQuestion } from './quiz'

/** Effekt → Item: nur seltene Effekte (höchstens so viele Items) */
export const RARE_MAX_ITEMS = 8

/**
 * Allgemeine oder technische Werte, die ohne Zusammenhang nichts über das Item sagen (Schlüssel wie effectKey).
 * Neue Werte aus Patches sind automatisch dabei, bis sie hier stehen.
 */
const GENERIC = new Set([
  'schaden', 'radius', 'dauer', 'zeitraum', 'verzögerung', 'verzögerung vor effekt', 'endradius', 'nahbereich', 'min. distanz',
  'heilung', 'regeneration', 'munition', 'bonusschaden', 'magieschaden', 'schaden pro sek.', 'max. schaden pro sek.',
  'min. heilung', 'max. instanzen', 'instanzendauer', 'zunahme pro schuss', 'auslösechance', 'schadensschwelle',
  'stärkungsdauer', 'schwächungsdauer', 'stärkungshäufigkeit', 'übergangsdauer', 'min. reduzierung', 'prozentsatz (verbündete)',
  'barrieredauer', 'regenerationsdauer', 'kanalisierungsdauer', 'beschwörungsdauer', 'verbindungsdauer',
  'wiederherstellungsverzögerung', 'betäubungsverzögerung', 'dauer der resistenzreduzierung', 'dauer bis max. schaden',
  'zeit bis max. effekt (hinterhalt)', 'dauer für hinterhalt', 'abklingzeit nach unterbrechung', 'schaden bei effektablauf',
  'erlittener schaden zu instanz', 'instanzenlimit (nicht-helden)', 'fähigkeit mit gewährten aufladungen',
  'fähigkeit ohne gewährte aufladungen', 'bewegungstempobonus (dauer)', 'stehldauer', 'immunitätsdauer',
  'insg. regenerierte lp', 'max. lp pro sek.', 'max. sprünge', 'verlangsamungsdauer', 'max. waffenschaden',
  'max. kugelresistenz', 'kugelresistenz pro instanz', 'magieschadensverstärkung pro instanz', 'waffenschaden pro instanz',
  'abklingzeit für veredelte fähigkeit', 'heilung pro aufladung', 'max. ausdauerwiederherstellung', 'zus. verbrauchte munition',
  'modellgröße', 'impulsschaden', 'explosionsschaden', 'aufprallschaden', 'nachgeladene kugeln', 'querschläger-ziele',
  'querschläger-reichweite',
  'temp. munition', 'heilung (helden)', 'heilung (nsc/seelenessenzen)', 'waffenschaden (nicht-helden)',
  'magiekraft während hinterhalt', 'magiekraft für veredelte fähigkeit',
])

/** Schlüssel eines Werts: ohne weiches Trennzeichen, klein */
export function effectKey(label: string): string {
  return label.replace(/­/g, '').trim().toLowerCase()
}

export function isGenericEffect(key: string): boolean {
  return GENERIC.has(key) || /radius|threshold|duration/.test(key)
}

export interface ParsedValue {
  num: number
  /** Einheit hinter der Zahl, z. B. "%", "m/s", "" */
  unit: string
  negative: boolean
}

/** „+1.75 m/s“ → 1.75, "m/s"; „−28 %“ → negativ */
export function parseValue(value: string): ParsedValue | undefined {
  const m = value.trim().match(/^([+\-−]?)\s*(\d+(?:[.,]\d+)?)\s*(.*)$/)
  if (!m) return undefined
  const num = Number(m[2].replace(',', '.'))
  if (!Number.isFinite(num)) return undefined
  return { num, unit: m[3].trim(), negative: m[1] === '-' || m[1] === '−' }
}

export interface EffectValue {
  itemId: string
  /** Anzeige-Name des Werts */
  label: string
  value: string
  section: SectionType
  conditional: boolean
  parsed?: ParsedValue
}

export interface EffectIndex {
  /** Wert-Schlüssel → Vorkommen (je Item das erste) */
  byKey: Map<string, EffectValue[]>
  /** Item → seine Wert-Schlüssel */
  keysOf: Map<string, string[]>
}

export function buildEffectIndex(items: readonly ItemCard[]): EffectIndex {
  const byKey = new Map<string, EffectValue[]>()
  const keysOf = new Map<string, string[]>()
  for (const item of items) {
    const keys: string[] = []
    for (const section of item.sections) {
      for (const stat of section.stats) {
        const key = effectKey(stat.label)
        if (!key || keys.includes(key)) continue
        keys.push(key)
        const list = byKey.get(key) ?? []
        list.push({
          itemId: item.id, label: stat.label, value: stat.value, section: section.type,
          conditional: !!stat.conditional, parsed: parseValue(stat.value),
        })
        byKey.set(key, list)
      }
    }
    keysOf.set(item.id, keys)
  }
  return { byKey, keysOf }
}

const nameList = (values: readonly EffectValue[], names: ReadonlyMap<string, string>) =>
  values.map(v => `${names.get(v.itemId) ?? v.itemId} ${v.value}`).join(' · ')

/** Effekt → Item: ein seltener, aussagekräftiger Wert des Items; falsch sind ähnliche Items ohne ihn */
export function rareEffectQuestion(item: ItemCard, pool: readonly ItemCard[], index: EffectIndex, rng: Rng): QuizQuestion | null {
  const keys = (index.keysOf.get(item.id) ?? []).filter(k => !isGenericEffect(k) && (index.byKey.get(k)?.length ?? 0) <= RARE_MAX_ITEMS)
  if (keys.length === 0) return null
  const key = keys[Math.floor(rng() * keys.length)]
  const holders = index.byKey.get(key)!
  const own = holders.find(v => v.itemId === item.id)!
  const holderIds = new Set(holders.map(v => v.itemId))
  const without = pool.filter(c => !holderIds.has(c.id))
  const opts = makeOptions(item.name, pickSimilar(item, without, 3, rng).map(c => c.name), rng)
  if (!opts) return null
  const names = new Map(pool.map(c => [c.id, c.name]))
  const label = own.label.replace(/­/g, '')
  return {
    kind: 'effect',
    itemId: item.id,
    subjectText: `${own.value} ${own.label}`,
    prompt: 'Welches Item hat diesen Wert?',
    info: holders.length === 1 ? `${label} gibt es nur bei ${item.name}.` : `${label}: ${nameList(holders, names)}`,
    ...opts,
  }
}

/** Vergleichbar: Grundwert (innate), ohne Bedingung, positiv, gleiche Einheit */
function comparable(v: EffectValue, unit?: string): v is EffectValue & { parsed: ParsedValue } {
  return v.section === 'innate' && !v.conditional && !!v.parsed && !v.parsed.negative && v.parsed.num > 0
    && (unit === undefined || v.parsed.unit === unit)
}

/** Wer gibt am meisten? – das Item hat den höchsten Wert unter 4 Items mit demselben Grundwert */
export function mostEffectQuestion(item: ItemCard, pool: readonly ItemCard[], index: EffectIndex, rng: Rng): QuizQuestion | null {
  const inPool = new Set(pool.map(c => c.id))
  for (const key of shuffle(index.keysOf.get(item.id) ?? [], rng)) {
    if (isGenericEffect(key)) continue
    const values = index.byKey.get(key) ?? []
    const own = values.find(v => v.itemId === item.id)
    if (!own || !comparable(own)) continue
    const lower = values.filter(v => v.itemId !== item.id && inPool.has(v.itemId) && comparable(v, own.parsed.unit) && v.parsed.num < own.parsed.num)
    if (lower.length < 3) continue
    const picked = [own, ...shuffle(lower, rng).slice(0, 3)]
    const names = new Map(pool.map(c => [c.id, c.name]))
    const options = shuffle(picked, rng)
    const label = own.label.replace(/­/g, '')
    return {
      kind: 'effect',
      itemId: item.id,
      subjectText: own.label,
      prompt: 'Welches Item gibt davon am meisten?',
      options: options.map(v => names.get(v.itemId) ?? v.itemId),
      answer: options.indexOf(own),
      info: `${label}: ${nameList([...picked].sort((a, b) => b.parsed!.num - a.parsed!.num), names)}`,
    }
  }
  return null
}

/** Eine der beiden Varianten (zufällig, sonst die mögliche) */
export function effectQuestion(item: ItemCard, pool: readonly ItemCard[], index: EffectIndex, rng: Rng): QuizQuestion | null {
  for (const make of shuffle([rareEffectQuestion, mostEffectQuestion], rng)) {
    const question = make(item, pool, index, rng)
    if (question) return question
  }
  return null
}
