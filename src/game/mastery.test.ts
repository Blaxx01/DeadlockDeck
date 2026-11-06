import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { State } from 'ts-fsrs'
import { DeckDB, submitBuildResult, type ReviewRecord } from '../data/db'
import { abilityCards, counterCard, fullHero, review } from '../test/masteryFixtures'
import { allHeroMastery, heroMastery, type HeroMasteryInput } from './heroMastery'
import { countMastery, masteryOf } from './mastery'

describe('masteryOf', () => {
  it('Neu, Bronze (gelernt), Silber ab 21 Tagen, Gold ab 60 Tagen bis zur nächsten Wiederholung', () => {
    expect(masteryOf(undefined)).toBe('none')
    expect(masteryOf(review('x', 0, State.New))).toBe('none')
    expect(masteryOf(review('x', 0, State.Learning))).toBe('bronze')
    expect(masteryOf(review('x', 20))).toBe('bronze')
    expect(masteryOf(review('x', 21))).toBe('silver')
    expect(masteryOf(review('x', 59))).toBe('silver')
    expect(masteryOf(review('x', 60))).toBe('gold')
    // vergessen: Abstand wieder kurz → wieder Bronze
    expect(masteryOf(review('x', 0, State.Relearning))).toBe('bronze')
  })

  it('zählt je Deck: gelernt (mind. Bronze), mind. Silber, Gold', () => {
    const reviews = new Map([review('a', 3), review('b', 30), review('c', 90), review('d', 0, State.New)].map(r => [r.id, r]))
    expect(countMastery(['a', 'b', 'c', 'd', 'e'], reviews)).toEqual({ total: 5, learned: 3, silver: 2, gold: 1 })
  })
})

describe('Hero-Meisterschaft', () => {
  const haze = fullHero(13, 'Haze')
  const input = (reviews: ReviewRecord[], extra: Partial<HeroMasteryInput> = {}): HeroMasteryInput => ({
    reviews: new Map(reviews.map(r => [r.id, r])),
    counterIds: new Set(['counter:hero_haze']),
    buildBests: {},
    guessClean: new Set(),
    ...extra,
  })

  it('je ein Stern für Hero-Karte, alle 4 Fähigkeiten, Counter-Karte (mind. Silber), Build-Quiz und Hero erraten', () => {
    expect(heroMastery(haze, input([])).stars).toEqual([])
    const silver = [review('hero:hero_haze', 30), ...haze.abilities.map(a => review(a.id, 25)), review('counter:hero_haze', 70)]
    const all = heroMastery(haze, input(silver, {
      buildBests: { 'typical:13': { errors: 0, ms: 50_000, at: 0 } },
      guessClean: new Set(['hero:hero_haze']),
    }))
    expect(all.stars).toEqual(['hero', 'abilities', 'counter', 'build', 'guess'])
    expect(all.counterLevel).toBe('gold')
    expect(all.abilityLevels.map(a => a.level)).toEqual(['silver', 'silver', 'silver', 'silver'])
  })

  it('kein Stern bei nur 3 von 4 Fähigkeiten, Bronze, Build mit Fehlern, Community-Build oder fehlender Counter-Karte', () => {
    const reviews = [
      review('hero:hero_haze', 10), ...haze.abilities.slice(0, 3).map(a => review(a.id, 40)), review('counter:hero_haze', 30),
    ]
    const m = heroMastery(haze, input(reviews, {
      counterIds: new Set(),
      buildBests: { 'typical:13': { errors: 1, ms: 1, at: 0 }, 'community:13': { errors: 0, ms: 1, at: 0 } },
    }))
    expect(m.stars).toEqual([])
    expect(m.heroLevel).toBe('bronze')
    expect(m.counterLevel).toBeUndefined()
  })

  it('liest alle Heroes alphabetisch aus der Datenbank', async () => {
    const database = new DeckDB(`m-${Math.random()}`)
    const vindicta = fullHero(3, 'Vindicta')
    await database.heroes.bulkPut([vindicta, haze])
    await database.abilities.bulkPut([...abilityCards(haze), ...abilityCards(vindicta)])
    await database.counters.put(counterCard(haze))
    await database.reviews.bulkPut([review('hero:hero_vindicta', 22), review('counter:hero_haze', 22)])
    await submitBuildResult('typical:13', { errors: 0, ms: 1000 }, database)
    const list = await allHeroMastery(database)
    expect(list.map(m => [m.hero.name, m.stars])).toEqual([['Haze', ['counter', 'build']], ['Vindicta', ['hero']]])
  })
})
