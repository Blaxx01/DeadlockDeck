import { describe, expect, it } from 'vitest'
import { FIRST_RANK_SOULS, parseRanks, RANK_STEPS, rankForSouls, rankImage, rankLabel, stepCost } from './ranks'

describe('Rangstufen', () => {
  it('66 Stufen von Novize 1 bis Ewiger 6, Kosten steigen von 800 auf 3.200', () => {
    expect(RANK_STEPS).toHaveLength(66)
    expect(RANK_STEPS[0]).toEqual({ tier: 1, sub: 1, souls: FIRST_RANK_SOULS })
    expect(RANK_STEPS.at(-1)).toMatchObject({ tier: 11, sub: 6 })
    expect(stepCost(1)).toBe(800)
    expect(stepCost(65)).toBe(3200)
    for (let i = 1; i < RANK_STEPS.length; i++) expect(RANK_STEPS[i].souls).toBeGreaterThan(RANK_STEPS[i - 1].souls)
  })

  it('Ewiger 6 nach etwa einem halben Jahr bei ~650 Souls am Tag', () => {
    const days = RANK_STEPS.at(-1)!.souls / 650
    expect(days).toBeGreaterThan(170)
    expect(days).toBeLessThan(220)
    // am Anfang ein Aufstieg alle 1–2 Tage
    expect(stepCost(1) / 650).toBeLessThan(2)
  })

  it('bestimmt Rang und Fortschritt aus den Souls', () => {
    expect(rankForSouls(0)).toMatchObject({ tier: 0, sub: 0, index: -1, floor: 0, progress: 0 })
    expect(rankForSouls(50).progress).toBe(0.5)
    expect(rankForSouls(100)).toMatchObject({ tier: 1, sub: 1, index: 0 })
    expect(rankForSouls(RANK_STEPS[6].souls)).toMatchObject({ tier: 2, sub: 1 })
    expect(rankForSouls(RANK_STEPS[6].souls - 1)).toMatchObject({ tier: 1, sub: 6 })
    const top = rankForSouls(10_000_000)
    expect(top).toMatchObject({ tier: 11, sub: 6, progress: 1 })
    expect(top.next).toBeUndefined()
  })
})

describe('Rang-Anzeige', () => {
  const assets = parseRanks([
    { tier: 0, name: 'Unwissender', images: { large_webp: 'u.webp' } },
    { tier: 8, name: 'Orakel', images: { large_webp: 'o.webp', large_subrank3_webp: 'o3.webp' } },
  ])

  it('nimmt Namen und Abzeichen aus der API, sonst die Standardnamen', () => {
    expect(rankLabel({ tier: 8, sub: 3 }, assets)).toBe('Orakel 3')
    expect(rankLabel({ tier: 0, sub: 0 }, assets)).toBe('Unwissender')
    expect(rankLabel({ tier: 11, sub: 6 })).toBe('Ewiger 6')
    expect(rankImage({ tier: 8, sub: 3 }, assets)).toBe('o3.webp')
    expect(rankImage({ tier: 8, sub: 4 }, assets)).toBe('o.webp') // Unterstufe fehlt → ohne Unterstufe
    expect(rankImage({ tier: 0, sub: 0 }, assets)).toBe('u.webp')
    expect(rankImage({ tier: 5, sub: 1 }, assets)).toBeUndefined()
  })
})
