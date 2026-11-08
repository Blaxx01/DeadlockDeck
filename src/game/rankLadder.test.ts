import { describe, expect, it } from 'vitest'
import { rankLadder } from './rankLadder'

describe('Rang-Übersicht', () => {
  it('alle Ränge von Unwissender bis Ewiger mit Schwelle, aktuellem Rang und fehlenden Souls', () => {
    const ladder = rankLadder(7_000, 7_000)
    expect(ladder).toHaveLength(12)
    expect(ladder.map(t => t.souls)).toEqual([0, 100, 5_500, 12_250, 20_350, 29_800, 40_600, 52_750, 66_250, 81_100, 97_300, 114_850])
    expect(ladder.map(t => t.state)).toEqual(['reached', 'reached', 'current', ...Array(9).fill('open')])
    expect(ladder[3]).toMatchObject({ tier: 3, missing: 5_250 })
    expect(ladder[2].missing).toBeUndefined()
  })

  it('Freischaltungen der Tagesmissionen bei Kultist, Akolyth und Wächter', () => {
    const ladder = rankLadder(7_000, 7_000)
    expect(ladder.filter(t => t.unlock).map(t => [t.tier, t.unlock!.text, t.unlock!.unlocked])).toEqual([
      [2, 'Sprint und Hero erraten', true],
      [3, 'Build-Quiz und Quiz-Punkte', false],
      [4, 'die vollen Ziele (z. B. Build-Quiz ohne Fehler)', false],
    ])
  })

  it('nach Verfall oder Ausgaben: höhere, schon erreichte Ränge bleiben erreicht – samt Freischaltungen', () => {
    const ladder = rankLadder(5_000, 13_000)
    expect(ladder.map(t => t.state).slice(0, 5)).toEqual(['reached', 'current', 'reached', 'reached', 'open'])
    expect(ladder[3].unlock).toEqual({ text: 'Build-Quiz und Quiz-Punkte', unlocked: true })
    expect(ladder[4]).toMatchObject({ state: 'open', missing: 15_350, unlock: { unlocked: false } })
  })
})
