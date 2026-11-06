import { describe, expect, it } from 'vitest'
import type { ItemCard, SectionType, Stat } from '../data/model'
import { item } from '../test/counterFixtures'
import { buildEffectIndex, effectQuestion, isGenericEffect, mostEffectQuestion, parseValue, rareEffectQuestion } from './effects'

function seeded(seed = 7) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const sec = (type: SectionType, ...stats: Stat[]) => ({ type, stats })
const st = (label: string, value: string, extra: Partial<Stat> = {}): Stat => ({ label, value, ...extra })

let n = 0
const card = (name: string, ...sections: ReturnType<typeof sec>[]): ItemCard => item(++n, name, 'vitality', { sections })

const POOL: ItemCard[] = [
  card('Headhunter', sec('innate', st('Bonuslebenspunkte', '+100')), sec('passive', st('Heilung pro Kopfschuss', '4 %'), st('Schaden', '50'))),
  card('Big Health', sec('innate', st('Bonuslebenspunkte', '+200'))),
  card('Small Health', sec('innate', st('Bonuslebenspunkte', '+50'))),
  card('Mid Health', sec('innate', st('Bonuslebenspunkte', '+75'))),
  card('Cond Health', sec('innate', st('Bonuslebenspunkte', '+500', { conditional: true }))),
  card('Vamp A', sec('innate', st('Kugellebensraub', '+10 %'))),
  card('Vamp B', sec('innate', st('Kugellebensraub', '+20 %'))),
  card('Blaster', sec('active', st('Schaden', '175'), st('Radius', '10 m'))),
  card('Runner', sec('innate', st('Bewegungstempo', '+1 m/s'))),
  card('Slower', sec('active', st('Bewegungstempo', '−28 %'))),
]

describe('Item-Effekt-Fragen', () => {
  const index = buildEffectIndex(POOL)

  it('liest Zahl, Einheit und Vorzeichen', () => {
    expect(parseValue('+1.75 m/s')).toEqual({ num: 1.75, unit: 'm/s', negative: false })
    expect(parseValue('−28 %')).toEqual({ num: 28, unit: '%', negative: true })
    expect(parseValue('4 LP/Sek.')).toEqual({ num: 4, unit: 'LP/Sek.', negative: false })
    expect(parseValue('Ja')).toBeUndefined()
  })

  it('allgemeine Werte wie Schaden und Radius zählen nicht', () => {
    expect(['schaden', 'radius', 'sprungradius', 'health threshold'].every(isGenericEffect)).toBe(true)
    expect(isGenericEffect('kugellebensraub')).toBe(false)
    expect(rareEffectQuestion(POOL[7], POOL, index, seeded())).toBeNull()
  })

  it('Effekt → Item: genau eine Antwort hat den Wert', () => {
    for (let seed = 1; seed < 20; seed++) {
      const q = rareEffectQuestion(POOL[0], POOL, index, seeded(seed))!
      // Bonuslebenspunkte haben zu viele Items nicht – hier gibt es 5, also selten genug; Schaden fällt weg
      expect(['4 % Heilung pro Kopfschuss', '+100 Bonuslebenspunkte']).toContain(q.subjectText)
      expect(q.options[q.answer]).toBe('Headhunter')
      const label = q.subjectText!.replace(/^\S+( %)? /, '')
      const holders = new Set(POOL.filter(c => c.sections.some(s => s.stats.some(x => x.label === label))).map(c => c.name))
      expect(q.options.filter(o => holders.has(o))).toEqual(['Headhunter'])
    }
    const q = rareEffectQuestion(POOL[5], POOL, index, seeded(2))!
    expect(q.info).toBe('Kugellebensraub: Vamp A +10 % · Vamp B +20 %')
  })

  it('Wer gibt am meisten? – nur Grundwerte ohne Bedingung, gleiche Einheit, eindeutiger Höchstwert', () => {
    const q = mostEffectQuestion(POOL[1], POOL, index, seeded(4))!
    expect(q.subjectText).toBe('Bonuslebenspunkte')
    expect(q.prompt).toBe('Welches Item gibt davon am meisten?')
    expect(q.options[q.answer]).toBe('Big Health')
    expect([...q.options].sort()).toEqual(['Big Health', 'Headhunter', 'Mid Health', 'Small Health'])
    expect(q.info).toBe('Bonuslebenspunkte: Big Health +200 · Headhunter +100 · Mid Health +75 · Small Health +50')
    // kleinster Wert: keine 3 kleineren → keine Frage; Bedingung (Cond Health) zählt nicht mit
    expect(mostEffectQuestion(POOL[2], POOL, index, seeded(4))).toBeNull()
    // Bewegungstempo: m/s und % sind nicht vergleichbar
    expect(mostEffectQuestion(POOL[8], POOL, index, seeded(4))).toBeNull()
  })

  it('wählt eine der möglichen Varianten', () => {
    const kinds = new Set<string>()
    for (let seed = 1; seed < 40; seed++) kinds.add(effectQuestion(POOL[1], POOL, index, seeded(seed))!.prompt)
    expect(kinds).toEqual(new Set(['Welches Item hat diesen Wert?', 'Welches Item gibt davon am meisten?']))
    expect(effectQuestion(POOL[7], POOL, index, seeded(1))).toBeNull()
  })
})
