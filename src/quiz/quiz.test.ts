import { describe, expect, it } from 'vitest'
import type { CounterCard, ItemCard, SlotType } from '../data/model'
import {
  BASE_POINTS, MAX_SPEED_BONUS, buildRound, descriptionOf, makeOptions, makeQuestion, pickSimilar,
  quizContext, redactName, scoreAnswer, type QuizQuestion,
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
    id: `item:${name}`, apiId: 0, className: name, name, slot, tier, cost: COST[tier], isActive: false,
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

describe('Was gefragt wird (Einstellung)', () => {
  const known = new Set(['item:Burst Fire', 'item:Extra Health', 'item:Mystic Burst'])
  const isKnown = (q: QuizQuestion) => known.has(q.itemId)

  it('„Gelerntes zuerst“: erst die gelernten Items, dann neue – als ungelernt markiert', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const round = buildRound(POOL, ['image', 'number'], seeded(seed), 10, { known, scope: 'learned-first' })
      expect(round).toHaveLength(10)
      expect(round.slice(0, 3).every(isKnown)).toBe(true)
      expect(round.slice(0, 3).some(q => q.unlearned)).toBe(false)
      expect(round.slice(3).every(q => !isKnown(q) && q.unlearned === true)).toBe(true)
      expect(new Set(round.map(q => q.itemId)).size).toBe(10)
    }
  })

  it('„Gelerntes zuerst“ mit genug gelernten Items: keine neuen', () => {
    const many = new Set(POOL.slice(0, 12).map(c => c.id))
    const round = buildRound(POOL, ['image'], seeded(3), 10, { known: many, scope: 'learned-first' })
    expect(round).toHaveLength(10)
    expect(round.every(q => many.has(q.itemId) && !q.unlearned)).toBe(true)
  })

  it('„Nur Gelerntes“: nur gelernte Items, die Runde wird kürzer; falsche Antworten weiter aus allen', () => {
    const round = buildRound(POOL, ['image'], seeded(), 10, { known, scope: 'learned-only' })
    expect(round.map(q => q.itemId).sort()).toEqual([...known].sort())
    expect(round.some(q => q.unlearned)).toBe(false)
    const names = new Set(POOL.filter(c => known.has(c.id)).map(c => c.name))
    expect(round.flatMap(q => q.options).some(o => !names.has(o))).toBe(true)
    expect(buildRound(POOL, ['image'], seeded(), 10, { known: new Set(), scope: 'learned-only' })).toEqual([])
  })

  it('„Alles“: wie bisher – ohne Markierung, dieselbe Runde wie ohne Einstellung', () => {
    const round = buildRound(POOL, ['image', 'number'], seeded(4), 10, { known, scope: 'all' })
    expect(round).toEqual(buildRound(POOL, ['image', 'number'], seeded(4)))
    expect(round.some(q => q.unlearned)).toBe(false)
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

describe('Counter-Fragen', () => {
  function counter(heroId: number, heroName: string, factors: Record<string, number>): CounterCard {
    const top = Object.entries(factors).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([itemId, factor]) => ({ itemId, factor }))
    return {
      id: `counter:hero_${heroName.toLowerCase()}`, heroId, heroName, order: heroId, top, updatedAt: 0,
      image: `https://cdn.example/${heroName}.png`, smallImage: `https://cdn.example/${heroName}_small.png`,
      factors: Object.fromEntries(Object.entries(factors).map(([name, f]) => [`item:${name}`, f])),
    }
  }
  const COUNTERS = [
    counter(10, 'Haze', {
      'Divine Barrier': 1.9, 'Rescue Beam': 1.4, 'Extra Health': 1.1, 'Basic Magazine': 0.9, 'Headshot Booster': 0.8,
      'Monster Rounds': 1.0, 'Burst Fire': 0.7, 'Mystic Burst': 0.95, 'Extra Charge': 0.6,
    }),
    counter(11, 'Vindicta', { 'Burst Fire': 2.0, 'Divine Barrier': 0.9, 'Rescue Beam': 0.8, 'Basic Magazine': 1.0, 'Extra Health': 0.7, 'Mystic Burst': 1.2 }),
    counter(12, 'Seven', { 'Mystic Burst': 1.5, 'Divine Barrier': 0.85, 'Burst Fire': 0.9, 'Rescue Beam': 1.0 }),
    counter(13, 'Abrams', { 'Extra Charge': 1.35, 'Divine Barrier': 1.0, 'Burst Fire': 0.5, 'Rescue Beam': 0.9 }),
    counter(14, 'Paige', { 'Divine Barrier': 0.7, 'Burst Fire': 0.95, 'Rescue Beam': 0.6, 'Mystic Burst': 0.9 }),
  ]
  const ctx = () => quizContext(POOL, { counters: COUNTERS })
  const byName = (name: string) => POOL.find(c => c.name === name)!
  const heroNamed = (name: string) => COUNTERS.find(c => c.heroName === name)!

  it('Hero → Item: richtig ist ein klarer Counter, falsch nur Items ohne Counter-Verhältnis', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const q = makeQuestion('counterItem', byName('Divine Barrier'), POOL, seeded(seed), ctx())
      expectValid(q)
      expect(q.options[q.answer]).toBe('Divine Barrier')
      expect(q.prompt).toBe('Welches Item wird gegen Haze besonders oft gekauft?')
      expect(q.portrait).toBe('https://cdn.example/Haze.png')
      expect(q.heroId).toBe(10)
      expect(q.cardId).toBe('counter:hero_haze') // Fehler zählen für die Counter-Karte
      for (const name of q.options.filter((_, i) => i !== q.answer)) {
        // nie Rescue Beam (auch klarer Counter), Extra Health (1,1×) oder Items ohne Daten
        expect(heroNamed('Haze').factors[`item:${name}`], name).toBeLessThanOrEqual(1)
      }
      expect(q.info).toBe('Klare Counter gegen Haze: Divine Barrier 1,9× · Rescue Beam 1,4×')
    }
  })

  it('Hero → Item: kein Counter irgendwo → keine Frage', () => {
    expect(makeQuestion('counterItem', byName('Headshot Booster'), POOL, seeded(), ctx())).toBeNull()
  })

  it('Item → Hero: richtiger Hero mit Icon, falsche nur mit bekanntem Faktor ≤ 1,0×', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const q = makeQuestion('counterHero', byName('Divine Barrier'), POOL, seeded(seed), ctx())
      expectValid(q)
      expect(q.options[q.answer]).toBe('Haze')
      expect(q.subjectId).toBe('item:Divine Barrier')
      expect(q.optionImages).toEqual(q.options.map(n => `https://cdn.example/${n}_small.png`))
      for (const name of q.options.filter((_, i) => i !== q.answer)) {
        expect(heroNamed(name).factors['item:Divine Barrier']).toBeLessThanOrEqual(1)
      }
      expect(q.info).toBe('Divine Barrier wird besonders oft gekauft gegen: Haze 1,9×')
    }
    // Mystic Burst: nur Haze und Paige sind sicher kein Counter (Vindicta 1,2×, Abrams ohne Daten) → zu wenige
    expect(makeQuestion('counterHero', byName('Mystic Burst'), POOL, seeded(), ctx())).toBeNull()
  })

  it('fragt in einer Runde jeden Hero und jedes Item höchstens einmal', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const round = buildRound(POOL, ['counterItem', 'counterHero'], seeded(seed), 10, { counters: COUNTERS })
      expect(round.length).toBeGreaterThan(0)
      expect(round.every(q => q.kind === 'counterItem' || q.kind === 'counterHero')).toBe(true)
      const heroes = round.map(q => q.heroId)
      expect(new Set(heroes).size).toBe(heroes.length)
      expect(new Set(round.map(q => q.itemId)).size).toBe(round.length)
    }
  })

  it('ohne Counter-Daten gibt es keine Counter-Fragen', () => {
    expect(buildRound(POOL, ['counterItem', 'counterHero'], seeded(), 10)).toEqual([])
  })

  it('„Nur Gelerntes“: nur Heroes mit gelernter Counter-Karte – das Item muss nicht gelernt sein', () => {
    const known = new Set(['counter:hero_haze'])
    for (let seed = 1; seed <= 20; seed++) {
      const round = buildRound(POOL, ['counterItem', 'counterHero'], seeded(seed), 10, { counters: COUNTERS, known, scope: 'learned-only' })
      expect(round).toHaveLength(1)
      expect(round[0]).toMatchObject({ cardId: 'counter:hero_haze', heroId: 10 })
      expect(round[0].unlearned).toBeUndefined()
    }
  })

  it('„Gelerntes zuerst“: erst die gelernte Counter-Karte, dann die anderen – markiert', () => {
    const known = new Set(['counter:hero_vindicta'])
    for (let seed = 1; seed <= 20; seed++) {
      const round = buildRound(POOL, ['counterItem', 'counterHero'], seeded(seed), 10, { counters: COUNTERS, known, scope: 'learned-first' })
      expect(round[0].cardId).toBe('counter:hero_vindicta')
      expect(round[0].unlearned).toBeUndefined()
      expect(round.length).toBeGreaterThan(1)
      expect(round.slice(1).every(q => q.unlearned === true && q.cardId !== 'counter:hero_vindicta')).toBe(true)
    }
  })
})
