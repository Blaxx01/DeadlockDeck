import { describe, expect, it } from 'vitest'
import type { HeroCard } from '../data/model'
import {
  MAX_REVEAL, abilityReveal, applyAction, buildGuessRound, canAsk, jokerOptions, makeGuessQuestion, stageStyle,
} from './guess'

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

function hero(n: number, extra: Partial<HeroCard> = {}): HeroCard {
  return {
    id: `hero:h${n}`, heroId: n, className: `h${n}`, name: `Hero ${n}`, order: n, tags: [], stats: [], hash: '',
    image: `https://cdn/h${n}_card.webp`, smallImage: `https://cdn/h${n}_sm.webp`,
    poses: [`https://cdn/h${n}_card.webp`, `https://cdn/h${n}_critical.webp`, `https://cdn/h${n}_gloat.webp`],
    abilities: [1, 2, 3, 4].map(s => ({ id: `ability:a${n}_${s}`, name: `Ability ${n}.${s}`, image: `https://cdn/a${n}_${s}.webp`, slot: s })),
    ...extra,
  }
}

const HEROES = Array.from({ length: 14 }, (_, i) => hero(i + 1))

describe('Punkte', () => {
  it('Aufdecken −20, Joker halbiert, falscher Tipp −15, nie unter 0', () => {
    let p = 100
    p = applyAction(p, 'reveal')
    expect(p).toBe(80)
    p = applyAction(p, 'joker')
    expect(p).toBe(40)
    p = applyAction(p, 'wrong')
    expect(p).toBe(25)
    expect(applyAction(5, 'wrong')).toBe(0)
    expect(applyAction(10, 'reveal')).toBe(0)
    expect(applyAction(25, 'joker')).toBe(12)
  })
})

describe('Runden', () => {
  it('10 verschiedene Heroes mit allen gewählten Varianten', () => {
    const round = buildGuessRound(HEROES, ['silhouette', 'zoom', 'blur', 'ability'], seeded())
    expect(round).toHaveLength(10)
    expect(new Set(round.map(q => q.heroId)).size).toBe(10)
    expect(new Set(round.map(q => q.kind))).toEqual(new Set(['silhouette', 'zoom', 'blur', 'ability']))
  })

  it('nur die gewählten Varianten', () => {
    const round = buildGuessRound(HEROES, ['blur'], seeded())
    expect(round.every(q => q.kind === 'blur')).toBe(true)
  })

  it('weicht aus, wenn ein Hero für die Variante keine Bilder hat', () => {
    const noAbilities = HEROES.map(h => ({ ...h, abilities: [] }))
    const round = buildGuessRound(noAbilities, ['ability', 'silhouette'], seeded())
    expect(round).toHaveLength(10)
    expect(round.every(q => q.kind === 'silhouette')).toBe(true)
    expect(buildGuessRound(noAbilities, ['ability'], seeded())).toEqual([])
  })

  it('braucht mindestens 4 Heroes und eine Variante', () => {
    expect(buildGuessRound(HEROES.slice(0, 3), ['blur'], seeded())).toEqual([])
    expect(buildGuessRound(HEROES, [], seeded())).toEqual([])
    expect(buildGuessRound(HEROES.slice(0, 6), ['blur'], seeded())).toHaveLength(6)
  })

  it('Fragen nutzen eine der Posen; Zoom hat einen Fokus; Ability mischt die Icons', () => {
    const rng = seeded(3)
    const h = HEROES[0]
    expect(h.poses).toContain(makeGuessQuestion(h, 'silhouette', rng)!.image)
    const z = makeGuessQuestion(h, 'zoom', rng)!
    expect(z.focus!.x).toBeGreaterThanOrEqual(35)
    expect(z.focus!.x).toBeLessThanOrEqual(65)
    expect(z.focus!.y).toBeGreaterThanOrEqual(30)
    expect(z.focus!.y).toBeLessThanOrEqual(60)
    const a = makeGuessQuestion(h, 'ability', rng)!
    expect(a.abilities!.map(x => x.name).sort()).toEqual(h.abilities.map(x => x.name).sort())
  })

  it('canAsk prüft Bilder', () => {
    expect(canAsk(hero(1, { poses: [], image: undefined }), 'blur')).toBe(false)
    expect(canAsk(hero(1, { poses: [] }), 'blur')).toBe(true) // Fallback auf das normale Kartenbild
    expect(canAsk(hero(1, { abilities: [{ id: 'x', name: 'x', image: 'y', slot: 1 }] }), 'ability')).toBe(false)
  })
})

describe('Joker', () => {
  const ids = HEROES.map(h => h.id)
  it('richtige Antwort + 3 andere, ohne schon falsch getippte', () => {
    for (let s = 1; s < 30; s++) {
      const opts = jokerOptions('hero:h5', ids, seeded(s), ['hero:h1', 'hero:h2'])
      expect(opts).toHaveLength(4)
      expect(new Set(opts).size).toBe(4)
      expect(opts).toContain('hero:h5')
      expect(opts).not.toContain('hero:h1')
      expect(opts).not.toContain('hero:h2')
    }
  })
  it('kommt auch mit vielen Fehlversuchen aus', () => {
    const opts = jokerOptions('hero:h1', ids.slice(0, 5), seeded(), ids.slice(1, 4))
    expect(opts).toHaveLength(4)
    expect(opts).toContain('hero:h1')
  })
})

describe('Aufdecken', () => {
  const q = { heroId: 'hero:h1', image: 'x', focus: { x: 50, y: 40 } }
  it('Silhouette wird heller, Unscharf schärfer, Zoom kleiner – Stufe 3 / gelöst = Original', () => {
    expect(stageStyle({ ...q, kind: 'silhouette' }, 0, false).filter).toBe('brightness(0)')
    expect(stageStyle({ ...q, kind: 'blur' }, 1, false).filter).toBe('blur(12px)')
    expect(stageStyle({ ...q, kind: 'zoom' }, 0, false)).toEqual({ transform: 'scale(3.4)', transformOrigin: '50% 40%' })
    expect(stageStyle({ ...q, kind: 'zoom' }, MAX_REVEAL, false)).toEqual({})
    expect(stageStyle({ ...q, kind: 'silhouette' }, 0, true)).toEqual({})
  })
  it('Fähigkeit → Hero: pro Stufe ein Icon mehr, Namen erst ganz zum Schluss', () => {
    const a = { heroId: 'hero:h1', kind: 'ability' as const, abilities: [1, 2, 3, 4].map(n => ({ name: `A${n}`, image: `i${n}` })) }
    expect(abilityReveal(a, 0, false)).toEqual({ count: 1, names: false })
    expect(abilityReveal(a, 2, false)).toEqual({ count: 3, names: false })
    expect(abilityReveal(a, 3, false)).toEqual({ count: 4, names: true })
    expect(abilityReveal(a, 0, true)).toEqual({ count: 4, names: true })
  })
})
