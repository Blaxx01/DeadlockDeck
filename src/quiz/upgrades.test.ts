import { describe, expect, it } from 'vitest'
import type { AbilityCard, HeroCard } from '../data/model'
import { abilityCards, fullHero } from '../test/masteryFixtures'
import { buildRound } from './quiz'
import { LEARNED_SHARE, nextUpgradeQuestion, upgradeQuestion, upgradeText } from './upgrades'

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

/** 3 Upgrades je Fähigkeit mit eindeutigen Texten */
function withUpgrades(h: HeroCard): AbilityCard[] {
  return abilityCards(h).map(a => ({
    ...a,
    image: `${a.id}.png`,
    upgrades: [1, 2, 5].map(cost => ({ cost, html: `<span>${a.name}</span> Upgrade <b>${cost}</b> AP` })),
  }))
}

const heroes = ['Haze', 'Seven', 'Dynamo'].map((n, i) => fullHero(i + 1, n))
const abilities = heroes.flatMap(withUpgrades)
const items = Array.from({ length: 6 }, (_, i) => ({
  id: `item:i${i}`, apiId: i, className: `i${i}`, name: `Item ${i}`, slot: 'weapon' as const, tier: 1, cost: 800,
  isActive: false, image: `i${i}.png`, timings: [], sections: [], buildsFrom: [], upgradesTo: [], fingerprint: '',
}))

describe('Upgrade-Fragen', () => {
  it('Text ohne HTML', () => {
    expect(upgradeText('<span>+1 s</span> Schlafdauer<br>Fügt&nbsp;15 zu')).toBe('+1 s Schlafdauer Fügt 15 zu')
  })

  it('„Was macht das x-AP-Upgrade …?“ – falsch: andere Stufen derselben Fähigkeit + eine andere Fähigkeit des Heroes', () => {
    const ability = abilities[0]
    for (let seed = 1; seed < 30; seed++) {
      const q = upgradeQuestion(ability, abilities, seeded(seed))!
      const cost = Number(q.prompt.match(/das (\d)-AP-Upgrade/)![1])
      expect(q.prompt).toBe(`Was macht das ${cost}-AP-Upgrade von ${ability.name}?`)
      expect(q.options[q.answer]).toBe(`${ability.name} Upgrade ${cost} AP`)
      expect(new Set(q.options).size).toBe(4)
      const own = q.options.filter(o => o.startsWith(`${ability.name} `))
      expect(own).toHaveLength(3)
      const other = q.options.find(o => !o.startsWith(`${ability.name} `))!
      // die vierte Antwort stammt von einer anderen Fähigkeit desselben Heroes
      expect(abilities.filter(a => a.heroId === ability.heroId && a.id !== ability.id).some(a => other.startsWith(a.name))).toBe(true)
      expect(q).toMatchObject({ kind: 'upgrade', itemId: ability.id, cardId: ability.id, image: ability.image, caption: 'Fähigkeit von Haze' })
      expect(q.info).toBe(`${ability.name}: 1 AP: ${ability.name} Upgrade 1 AP · 2 AP: ${ability.name} Upgrade 2 AP · 5 AP: ${ability.name} Upgrade 5 AP`)
    }
  })

  it('gelernte Fähigkeiten kommen meistens dran, andere ab und zu; jede nur einmal je Runde', () => {
    const learned = new Set([abilities[0].id, abilities[5].id])
    const rng = seeded(3)
    let fromLearned = 0
    const runs = 400
    for (let i = 0; i < runs; i++) if (learned.has(nextUpgradeQuestion(abilities, learned, new Set(), rng)!.cardId!)) fromLearned++
    const share = fromLearned / runs
    // 75 % gezielt + der Zufallsanteil aus allen (2 von 12)
    expect(share).toBeGreaterThan(LEARNED_SHARE - 0.05)
    expect(share).toBeLessThan(0.9)
    expect(nextUpgradeQuestion(abilities, learned, new Set(abilities.map(a => a.id)), rng)).toBeNull()
  })

  it('nur gelernte („only“) oder alle („any“) Fähigkeiten', () => {
    const learned = new Set([abilities[0].id, abilities[5].id])
    const rng = seeded(4)
    for (let i = 0; i < 50; i++) expect(learned.has(nextUpgradeQuestion(abilities, learned, new Set(), rng, 'only')!.cardId!)).toBe(true)
    expect(nextUpgradeQuestion(abilities, learned, learned, rng, 'only')).toBeNull()
    const seen = new Set(Array.from({ length: 200 }, () => nextUpgradeQuestion(abilities, learned, new Set(), rng, 'any')!.cardId))
    expect(seen.size).toBe(abilities.length)
  })

  it('Einstellung: „Nur Gelerntes“ nur gelernte Fähigkeiten, „Gelerntes zuerst“ füllt mit anderen auf (markiert)', () => {
    const known = new Set([abilities[0].id, abilities[5].id])
    const only = buildRound(items, ['upgrade'], seeded(2), 10, { abilities, known, scope: 'learned-only' })
    expect(only.map(q => q.cardId).sort()).toEqual([...known].sort())
    expect(only.some(q => q.unlearned)).toBe(false)
    const first = buildRound(items, ['upgrade'], seeded(2), 10, { abilities, known, scope: 'learned-first' })
    expect(first).toHaveLength(10)
    expect(first.slice(0, 2).map(q => q.cardId).sort()).toEqual([...known].sort())
    expect(first.slice(2).every(q => q.unlearned === true && !known.has(q.cardId!))).toBe(true)
  })

  it('in Quiz-Runden: Fähigkeiten statt Items, ohne Fähigkeiten keine Upgrade-Fragen', () => {
    const round = buildRound(items, ['upgrade'], seeded(5), 10, { abilities })
    expect(round).toHaveLength(10)
    expect(round.every(q => q.kind === 'upgrade')).toBe(true)
    expect(new Set(round.map(q => q.itemId)).size).toBe(10)
    expect(buildRound(items, ['upgrade'], seeded(5), 10, {})).toEqual([])
  })
})
