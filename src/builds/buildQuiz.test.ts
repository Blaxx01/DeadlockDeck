import { describe, expect, it } from 'vitest'
import type { BuildRecord, ItemCard } from '../data/model'
import { item } from '../test/counterFixtures'
import {
  buildMistakes, EXTRA_NAMES, formatDuration, makeBuildRound, pickName, remainingOptions, selectIcon, startProgress,
} from './buildQuiz'

/** Deterministischer Zufall (mulberry32) */
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

const SLOTS = ['weapon', 'vitality', 'spirit'] as const
const ITEMS: ItemCard[] = Array.from({ length: 30 }, (_, i) => item(i + 1, `Item ${i + 1}`, SLOTS[i % 3], { tier: (i % 4) + 1 }))
const BY_ID = new Map(ITEMS.map(i => [i.id, i]))

const BUILD: BuildRecord = {
  id: 'typical:hero_haze', source: 'typical', heroId: 13, heroName: 'Haze', updatedAt: 0,
  sections: [
    { title: 'Früh', items: [{ itemId: 'item:item_1' }, { itemId: 'item:item_2' }, { itemId: 'item:gone' }] },
    { title: 'Spät', items: [{ itemId: 'item:item_3' }, { itemId: 'item:item_1' }] },
  ],
}

describe('makeBuildRound', () => {
  it('ordnet Abschnitt für Abschnitt, ohne fehlende und doppelte Items, mit 6 Extra-Namen', () => {
    const round = makeBuildRound(BUILD, BY_ID, seeded())!
    expect(round.order.map(i => i.name)).toEqual(['Item 1', 'Item 2', 'Item 3'])
    expect(round.sectionOf).toEqual([0, 0, 1])
    expect(round.options).toHaveLength(3 + EXTRA_NAMES)
    const extras = round.options.filter(o => !round.order.includes(o))
    expect(extras).toHaveLength(EXTRA_NAMES)
    expect(new Set(round.options.map(o => o.name)).size).toBe(round.options.length)
  })

  it('braucht mindestens 2 Items', () => {
    expect(makeBuildRound({ ...BUILD, sections: [{ title: 'X', items: [{ itemId: 'item:item_1' }] }] }, BY_ID)).toBeNull()
  })
})

describe('Runde', () => {
  const round = makeBuildRound(BUILD, BY_ID, seeded())!
  const extra = round.options.find(o => !round.order.includes(o))!

  it('prüft sofort: falsch zählt als Fehlversuch, richtig geht zum nächsten offenen Icon', () => {
    let p = startProgress(round)
    let r = pickName(round, p, extra.id)
    expect(r).toMatchObject({ correct: false, done: false })
    expect(r.progress.errors).toBe(1)
    // derselbe falsche Name nochmal: zählt, steht aber nur einmal in der Liste
    r = pickName(round, r.progress, extra.id)
    expect(r.progress.errors).toBe(2)
    expect(r.progress.wrong[0]).toEqual([extra.id])
    // Item 2 ist für Icon 1 falsch
    r = pickName(round, r.progress, 'item:item_2')
    expect(r.progress.wrong[0]).toEqual([extra.id, 'item:item_2'])

    r = pickName(round, r.progress, 'item:item_1')
    expect(r).toMatchObject({ correct: true, done: false })
    expect(r.progress.current).toBe(1)
    p = r.progress
    expect(remainingOptions(round, p).map(o => o.id)).not.toContain('item:item_1')
    expect(remainingOptions(round, p)).toContain(extra)
  })

  it('anderes offenes Icon wählen, im Kreis weiter, fertig nach dem letzten', () => {
    let p = selectIcon(startProgress(round), 2)
    expect(p.current).toBe(2)
    let r = pickName(round, p, 'item:item_3')
    expect(r.progress.current).toBe(0) // im Kreis zum ersten offenen
    expect(selectIcon(r.progress, 2)).toBe(r.progress) // gelöstes Icon nicht wählbar
    r = pickName(round, r.progress, 'item:item_1')
    p = r.progress
    r = pickName(round, p, 'item:item_2')
    expect(r).toMatchObject({ correct: true, done: true })
  })

  it('listet die Fehler mit den getippten Namen', () => {
    let p = startProgress(round)
    p = pickName(round, p, extra.id).progress
    p = pickName(round, p, 'item:item_1').progress
    p = pickName(round, p, 'item:item_3').progress
    p = pickName(round, p, 'item:item_2').progress
    expect(buildMistakes(round, p).map(m => [m.item.name, m.picked.map(x => x.name)])).toEqual([
      ['Item 1', [extra.name]],
      ['Item 2', ['Item 3']],
    ])
  })
})

describe('formatDuration', () => {
  it('zeigt Minuten:Sekunden', () => {
    expect(formatDuration(84_400)).toBe('1:24')
    expect(formatDuration(5_000)).toBe('0:05')
    expect(formatDuration(-3)).toBe('0:00')
  })
})
