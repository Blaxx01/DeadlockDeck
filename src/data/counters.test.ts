import { describe, expect, it } from 'vitest'
import { hero, item, stat } from '../test/counterFixtures'
import { computeCounters, detectCounterChanges, effectSummary, formatFactor, MIN_PURCHASES } from './counters'
import type { CounterCard, ItemCard } from './model'

const ITEMS = [item(1, 'Alpha'), item(2, 'Beta'), item(3, 'Gamma'), item(4, 'Delta')]
// Insgesamt kauft jeder jedes Item gleich oft (Anteil je 25 %)
const BASE = [stat(1, 10_000), stat(2, 10_000), stat(3, 10_000), stat(4, 10_000), stat(99, 50_000)]

describe('computeCounters', () => {
  it('berechnet den Kauf-Faktor und nimmt die Top 3', () => {
    // Gegen Haze: Alpha 40 % statt 25 % der Käufe → 1,6×; der Rest 20 % → 0,8×
    const byEnemy = [stat(1, 8000, 10), stat(2, 4000, 10), stat(3, 4000, 10), stat(4, 4000, 10), stat(99, 9000, 10)]
    const [card, ...rest] = computeCounters(byEnemy, BASE, ITEMS, [hero(10, 'Haze')], 123)
    expect(rest).toHaveLength(0)
    expect(card.id).toBe('counter:hero_haze')
    expect(card.heroName).toBe('Haze')
    expect(card.updatedAt).toBe(123)
    expect(card.top).toEqual([
      { itemId: 'item:alpha', factor: 1.6 },
      { itemId: 'item:beta', factor: 0.8 },
      { itemId: 'item:delta', factor: 0.8 },
    ])
    // Item 99 ist nicht im Shop → zählt weder als Counter noch in den Summen
    expect(Object.keys(card.factors).sort()).toEqual(['item:alpha', 'item:beta', 'item:delta', 'item:gamma'])
  })

  it('ignoriert Items mit zu wenig Käufen und Heroes mit zu wenig Daten', () => {
    const few = MIN_PURCHASES - 1
    const byEnemy = [
      stat(1, 8000, 10), stat(2, few, 10), stat(3, 4000, 10), stat(4, 4000, 10),
      // Neuer Hero: nur zwei Items mit genug Käufen
      stat(1, 3000, 11), stat(2, 3000, 11), stat(3, few, 11),
    ]
    const cards = computeCounters(byEnemy, BASE, ITEMS, [hero(10, 'Haze'), hero(11, 'Newbie')], 0)
    expect(cards.map(c => c.heroName)).toEqual(['Haze'])
    expect(cards[0].factors['item:beta']).toBeUndefined()
    expect(cards[0].top.map(t => t.itemId)).not.toContain('item:beta')
  })

  it('sortiert die klarsten Counter zuerst', () => {
    const byEnemy = [
      ...[stat(1, 6000, 10), stat(2, 4000, 10), stat(3, 4000, 10), stat(4, 4000, 10)],
      ...[stat(2, 9000, 11), stat(1, 3000, 11), stat(3, 3000, 11), stat(4, 3000, 11)],
    ]
    const cards = computeCounters(byEnemy, BASE, ITEMS, [hero(10, 'Haze'), hero(11, 'Vindicta')], 0)
    expect(cards.map(c => [c.heroName, c.order, c.top[0].itemId])).toEqual([
      ['Vindicta', 0, 'item:beta'],
      ['Haze', 1, 'item:alpha'],
    ])
  })

  it('liefert nichts ohne Vergleichsdaten', () => {
    expect(computeCounters([stat(1, 5000, 10)], [], ITEMS, [hero(10, 'Haze')], 0)).toEqual([])
  })
})

describe('detectCounterChanges', () => {
  const names: Record<string, string> = { 'item:alpha': 'Alpha', 'item:beta': 'Beta' }
  const card = (top: [string, number][]): CounterCard => ({
    id: 'counter:hero_haze', heroId: 10, heroName: 'Haze', order: 0, factors: {}, updatedAt: 0,
    top: top.map(([itemId, factor]) => ({ itemId, factor })),
  })
  const detect = (before: CounterCard[], after: CounterCard[]) => detectCounterChanges(before, after, 500, id => names[id])

  it('meldet einen neuen klaren Top-Counter mit vorher → nachher', () => {
    expect(detect([card([['item:alpha', 1.6]])], [card([['item:beta', 1.4], ['item:alpha', 1.3]])])).toEqual([{
      id: 'counter:hero_haze', detectedAt: 500, kind: 'changed',
      changes: [{ label: 'Wichtigstes Item', before: 'Alpha 1,6×', after: 'Beta 1,4×' }],
    }])
  })

  it('ignoriert schwache neue Top-Items, gleiche Top-Items und neue Heroes', () => {
    expect(detect([card([['item:alpha', 1.6]])], [card([['item:beta', 1.2]])])).toEqual([])
    expect(detect([card([['item:alpha', 1.6]])], [card([['item:alpha', 2.4]])])).toEqual([])
    expect(detect([], [card([['item:beta', 1.9]])])).toEqual([])
  })
})

describe('effectSummary', () => {
  const sections = (...list: [ItemCard['sections'][number]['type'], string][]) =>
    list.map(([type, html]) => ({ type, html, stats: [] }))

  it('nimmt den ersten Satz – Aktiv vor Passiv vor Boni', () => {
    const it1 = item(1, 'Metal Skin', 'vitality', {
      sections: sections(['innate', ''], ['passive', 'Passiver Text.'], ['active', '<b>Du</b> wirst immun gegen\n Kugelschaden. Dauer 3 s.']),
    })
    expect(effectSummary(it1)).toBe('Du wirst immun gegen Kugelschaden.')
    expect(effectSummary(item(2, 'Spellbreaker', 'spirit', { sections: sections(['passive', 'Reduziert hohen Magieschaden. Mehr.']) })))
      .toBe('Reduziert hohen Magieschaden.')
  })

  it('trennt nicht bei „z. B.“ und kürzt lange Sätze', () => {
    expect(effectSummary(item(1, 'X', 'spirit', { sections: sections(['passive', 'Hilft z. B. gegen Haze. Zweiter Satz.']) })))
      .toBe('Hilft z. B. gegen Haze.')
    const long = `${'Sehr langer Effekt '.repeat(12)}Ende.`
    const short = effectSummary(item(1, 'X', 'spirit', { sections: sections(['passive', long]) }), 60)!
    expect(short.length).toBeLessThanOrEqual(60)
    expect(short.endsWith(' …')).toBe(true)
  })

  it('gibt undefined ohne Text', () => {
    expect(effectSummary(item(1, 'X'))).toBeUndefined()
  })
})

describe('formatFactor', () => {
  it('zeigt eine Nachkommastelle mit Komma', () => {
    expect(formatFactor(2.06)).toBe('2,1×')
    expect(formatFactor(1)).toBe('1,0×')
  })
})
