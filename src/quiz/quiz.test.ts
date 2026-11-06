import { describe, expect, it } from 'vitest'
import type { ItemCard, SlotType } from '../data/model'
import {
  BASE_POINTS, MAX_SPEED_BONUS, buildRound, descriptionOf, makeOptions, makeQuestion, pickSimilar,
  redactName, scoreAnswer, type QuizQuestion,
} from './quiz'

/** Deterministischer Zufall (mulberry32) – auch benachbarte Seeds liefern verschiedene Folgen */
function seeded(seed = 42) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const COST = [0, 800, 1600, 3200, 6400]

function card(name: string, slot: SlotType, tier: number, extra: Partial<ItemCard> = {}): ItemCard {
  return {
    id: `item:${name}`, className: name, name, slot, tier, cost: COST[tier], isActive: false,
    image: `https://cdn.example/${name}.png`, timings: [], sections: [], buildsFrom: [], upgradesTo: [], fingerprint: '',
    ...extra,
  }
}

const desc = (text: string) => [{ type: 'passive' as const, html: text, stats: [] }]

const POOL: ItemCard[] = [
  card('Basic Magazine', 'weapon', 1, { upgradesTo: ['Titanic Magazine'] }),
  card('Headshot Booster', 'weapon', 1),
  card('High-Velocity Mag', 'weapon', 1),
  card('Monster Rounds', 'weapon', 1),
  card('Titanic Magazine', 'weapon', 3, { buildsFrom: ['Basic Magazine'] }),
  card('Burst Fire', 'weapon', 3),
  card('Pristine Emblem', 'weapon', 3),
  card('Healing Rite', 'vitality', 1, {
    isActive: true,
    timings: [{ kind: 'cooldown', label: 'Abklingzeit', value: '60s' }, { kind: 'duration', label: 'Dauer', value: '17s' }],
    sections: desc('Heilt ein Ziel über Zeit. Healing Rite hält 17 Sekunden.'),
  }),
  card('Enduring Spirit', 'vitality', 1, { timings: [{ kind: 'cooldown', label: 'Abklingzeit', value: '40s' }] }),
  card('Extra Health', 'vitality', 1),
  card('Divine Barrier', 'vitality', 2, {
    timings: [{ kind: 'cooldown', label: 'Abklingzeit', value: '30s' }],
    sections: desc('Gibt einem Verbündeten einen Schild und Bewegungstempo.'),
  }),
  card('Rescue Beam', 'vitality', 2, { timings: [{ kind: 'cooldown', label: 'Abklingzeit', value: '35s' }] }),
  card('Mystic Burst', 'spirit', 1, { sections: desc('Fügt bei hohem Schaden zusätzlichen Spirit-Schaden zu.') }),
  card('Extra Charge', 'spirit', 1),
  card('Improved Cooldown', 'spirit', 2),
  card('Boundless Spirit', 'spirit', 4),
]

function expectValid(q: QuizQuestion | null): asserts q is QuizQuestion {
  expect(q).not.toBeNull()
  expect(q!.options).toHaveLength(4)
  expect(new Set(q!.options).size).toBe(4)
  expect(q!.answer).toBeGreaterThanOrEqual(0)
  expect(q!.answer).toBeLessThan(4)
}

const byName = (n: string) => POOL.find(c => c.name === n)!

describe('Distraktoren', () => {
  it('bevorzugt gleiche Kategorie und gleiches Tier', () => {
    const picks = pickSimilar(byName('Headshot Booster'), POOL, 3, seeded())
    expect(picks).toHaveLength(3)
    for (const p of picks) {
      expect(p.slot).toBe('weapon')
      expect(p.tier).toBe(1)
    }
  })

  it('lässt ausgeschlossene Namen und das Ziel selbst weg', () => {
    const picks = pickSimilar(byName('Basic Magazine'), POOL, 15, seeded(), ['Monster Rounds'])
    const names = picks.map(p => p.name)
    expect(names).not.toContain('Basic Magazine')
    expect(names).not.toContain('Monster Rounds')
  })

  it('makeOptions braucht 3 verschiedene falsche Antworten', () => {
    expect(makeOptions('A', ['B', 'B', 'A'], seeded())).toBeNull()
    const ok = makeOptions('A', ['B', 'C', 'D', 'E'], seeded())!
    expect(ok.options[ok.answer]).toBe('A')
    expect(ok.options).toHaveLength(4)
  })
})

describe('Fragetypen', () => {
  it('Bild → Name', () => {
    const item = byName('Burst Fire')
    const q = makeQuestion('image', item, POOL, seeded())
    expectValid(q)
    expect(q.image).toBe(item.image)
    expect(q.options[q.answer]).toBe('Burst Fire')
    expect(makeQuestion('image', { ...item, image: undefined }, POOL, seeded())).toBeNull()
  })

  it('Beschreibung → Item schwärzt den Namen', () => {
    const q = makeQuestion('description', byName('Healing Rite'), POOL, seeded())
    expectValid(q)
    expect(q.html).not.toMatch(/healing rite/i)
    expect(q.html).toContain('…')
    expect(q.options[q.answer]).toBe('Healing Rite')
    expect(makeQuestion('description', byName('Extra Health'), POOL, seeded())).toBeNull()
  })

  it('Beschreibung → Item nimmt keine Items mit gleichem Text als falsche Antwort', () => {
    const twinText = desc('Exakt derselbe Effekttext für beide Items hier.')
    const pool = [...POOL, card('Twin A', 'spirit', 1, { sections: twinText }), card('Twin B', 'spirit', 1, { sections: twinText })]
    for (let seed = 1; seed < 30; seed++) {
      const q = makeQuestion('description', pool.find(c => c.name === 'Twin A')!, pool, seeded(seed))
      expectValid(q)
      expect(q.options).not.toContain('Twin B')
    }
  })

  it('Zahlen: Kosten, Tier und Cooldown sind korrekt', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed < 40; seed++) {
      const q = makeQuestion('number', byName('Healing Rite'), POOL, seeded(seed))
      expectValid(q)
      const right = q.options[q.answer]
      if (q.prompt.startsWith('Wie viel kostet')) {
        expect(right).toBe('800 Souls')
        seen.add('cost')
      } else if (q.prompt.startsWith('Welches Tier')) {
        expect(right).toBe('Tier 1')
        seen.add('tier')
      } else {
        expect(q.prompt).toBe('Welchen Cooldown hat Healing Rite?')
        expect(right).toBe('60s')
        expect(q.options.every(o => /^\d+s$/.test(o))).toBe(true)
        seen.add('cooldown')
      }
      expect(q.subjectId).toBe('item:Healing Rite')
    }
    expect(seen).toEqual(new Set(['cost', 'tier', 'cooldown']))
  })

  it('Zahlen: Cooldown kommt etwa so oft wie Kosten und Tier zusammen', () => {
    let cooldown = 0
    const runs = 400
    for (let seed = 1; seed <= runs; seed++) {
      const q = makeQuestion('number', byName('Healing Rite'), POOL, seeded(seed))!
      if (q.prompt.startsWith('Welchen Cooldown')) cooldown++
    }
    expect(cooldown / runs).toBeGreaterThan(0.4)
    expect(cooldown / runs).toBeLessThan(0.6)
  })

  it('Zahlen: formatiert Kosten deutsch', () => {
    for (let seed = 1; seed < 40; seed++) {
      const q = makeQuestion('number', byName('Boundless Spirit'), POOL, seeded(seed))!
      if (q.prompt.startsWith('Wie viel kostet')) {
        expect(q.options[q.answer]).toBe('6.400 Souls')
        return
      }
    }
    throw new Error('keine Kostenfrage erzeugt')
  })

  it('Build-Pfad in beide Richtungen, ohne zweite richtige Antwort', () => {
    const up = makeQuestion('build', byName('Basic Magazine'), POOL, seeded())
    expectValid(up)
    expect(up.prompt).toBe('In welches Item upgradet Basic Magazine?')
    expect(up.options[up.answer]).toBe('Titanic Magazine')

    const down = makeQuestion('build', byName('Titanic Magazine'), POOL, seeded())
    expectValid(down)
    expect(down.prompt).toBe('Auf welchem Item baut Titanic Magazine auf?')
    expect(down.options[down.answer]).toBe('Basic Magazine')

    expect(makeQuestion('build', byName('Burst Fire'), POOL, seeded())).toBeNull()
  })

  it('Build-Pfad: andere gültige Upgrades tauchen nicht als falsche Antwort auf', () => {
    const pool = [
      ...POOL.filter(c => c.name !== 'Basic Magazine'),
      card('Basic Magazine', 'weapon', 1, { upgradesTo: ['Titanic Magazine', 'Burst Fire'] }),
    ]
    for (let seed = 1; seed < 30; seed++) {
      const q = makeQuestion('build', pool.find(c => c.name === 'Basic Magazine')!, pool, seeded(seed))
      expectValid(q)
      const wrong = q.options.filter((_, i) => i !== q.answer)
      expect(wrong).not.toContain('Titanic Magazine')
      expect(wrong).not.toContain('Burst Fire')
    }
  })
})

describe('buildRound', () => {
  it('baut 10 Fragen mit verschiedenen Items und gemischten Typen', () => {
    const round = buildRound(POOL, ['image', 'description', 'number', 'build'], seeded())
    expect(round).toHaveLength(10)
    expect(new Set(round.map(q => q.itemId)).size).toBe(10)
    const kinds = new Set(round.map(q => q.kind))
    expect(kinds).toEqual(new Set(['image', 'description', 'number', 'build']))
    round.forEach(expectValid)
  })

  it('verwendet nur die gewählten Fragetypen', () => {
    const round = buildRound(POOL, ['number'], seeded())
    expect(round).toHaveLength(10)
    expect(round.every(q => q.kind === 'number')).toBe(true)
  })

  it('wird kürzer statt hängen zu bleiben, wenn ein Typ ausgeht', () => {
    // nur 2 Items haben einen Build-Pfad
    const round = buildRound(POOL, ['build'], seeded())
    expect(round).toHaveLength(2)
  })

  it('braucht mindestens 4 Items', () => {
    expect(buildRound(POOL.slice(0, 3), ['image'], seeded())).toEqual([])
    expect(buildRound(POOL, [], seeded())).toEqual([])
  })
})

describe('Punkte', () => {
  it('gibt Basis + Zeitbonus, nichts für falsch', () => {
    expect(scoreAnswer(false, 1000)).toBe(0)
    expect(scoreAnswer(true, 0)).toBe(BASE_POINTS + MAX_SPEED_BONUS)
    expect(scoreAnswer(true, 7500)).toBe(BASE_POINTS + MAX_SPEED_BONUS / 2)
    expect(scoreAnswer(true, 60_000)).toBe(BASE_POINTS)
  })
})

describe('Text-Helfer', () => {
  it('redactName ist unabhängig von Groß-/Kleinschreibung und Sonderzeichen', () => {
    expect(redactName('Mit High-Velocity Mag (T1) und high-velocity mag', 'High-Velocity Mag')).toBe('Mit … (T1) und …')
    expect(redactName('a+b', 'a+b')).toBe('…')
  })
  it('descriptionOf ignoriert zu kurze Texte', () => {
    expect(descriptionOf(card('X', 'spirit', 1, { sections: desc('<b>kurz</b>') }))).toBeUndefined()
  })
})
