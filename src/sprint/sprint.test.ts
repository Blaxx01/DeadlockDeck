import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { DeckDB, getSprintHighscores, submitSprintScore } from '../data/db'
import type { HeroCard } from '../data/model'
import { item } from '../test/counterFixtures'
import { abilityCards, fullHero } from '../test/masteryFixtures'
import { clockLeft, clockReducer, nextSprintQuestion, sprintKinds, sprintTimeLeft, startClock, SPRINT_MS, type SprintCards } from './sprint'

/** Deterministischer Zufall */
function seeded(seed = 1) {
  let a = seed
  return () => {
    a = (a * 16807) % 2147483647
    return (a - 1) / 2147483646
  }
}

const heroes: HeroCard[] = ['Haze', 'Vindicta', 'Seven', 'Abrams', 'Paige'].map((name, i) => ({ ...fullHero(i + 1, name), poses: [`pose-${name}-1`, `pose-${name}-2`] }))
const abilities = heroes.flatMap(h => abilityCards(h).map(a => ({ ...a, image: `${a.id}.png` })))
const items = Array.from({ length: 12 }, (_, i) => item(i + 1, `Item ${i + 1}`, i % 2 ? 'spirit' : 'weapon', { tier: 1 + (i % 4) }))
const cards: SprintCards = { items, abilities, heroes }

describe('Sprint-Fragen', () => {
  it('Items, Fähigkeiten und Heroes am Bild mit 4 verschiedenen Antworten', () => {
    const rng = seeded(3)
    const used = new Set<string>()
    const kinds = new Set<string>()
    for (let i = 0; i < 30; i++) {
      const q = nextSprintQuestion(cards, 'all', used, rng)!
      kinds.add(q.kind)
      expect(new Set(q.options).size).toBe(4)
      expect(q.answer).toBeGreaterThanOrEqual(0)
      if (q.kind === 'item') {
        expect(q.options[q.answer]).toBe(items.find(c => c.id === q.cardId)!.name)
        expect(q.image).toBe(items.find(c => c.id === q.cardId)!.image)
      }
      if (q.kind === 'ability') {
        const a = abilities.find(c => c.id === q.cardId)!
        expect(q.options[q.answer]).toBe(a.name)
        expect(q.detail).toBe(`Fähigkeit von ${a.heroName}`)
      }
      if (q.kind === 'hero') {
        const h = heroes.find(c => c.id === q.cardId)!
        expect(q.options[q.answer]).toBe(h.name)
        expect(h.poses).toContain(q.image)
      }
    }
    expect([...kinds].sort()).toEqual(['ability', 'hero', 'item'])
  })

  it('nur die gewählte Sorte; jede Karte erst wieder, wenn alle dran waren', () => {
    const rng = seeded(7)
    const used = new Set<string>()
    const ids = Array.from({ length: heroes.length }, () => nextSprintQuestion(cards, 'heroes', used, rng)!)
    expect(ids.every(q => q.kind === 'hero')).toBe(true)
    expect(new Set(ids.map(q => q.cardId)).size).toBe(heroes.length)
    // danach geht es von vorne los
    expect(nextSprintQuestion(cards, 'heroes', used, rng)!.kind).toBe('hero')
  })

  it('Sorten mit weniger als 4 Karten fallen weg', () => {
    const few: SprintCards = { items, abilities: [], heroes: heroes.slice(0, 3) }
    expect(sprintKinds(few, 'all')).toEqual(['item'])
    expect(sprintKinds(few, 'heroes')).toEqual([])
    expect(nextSprintQuestion(few, 'heroes', new Set())).toBeNull()
  })

  it('Zeit: 60 s, je Fehler 3 s weniger, Pausen zählen nicht, nie unter 0', () => {
    expect(sprintTimeLeft(1000, 1000, 0)).toBe(SPRINT_MS)
    expect(sprintTimeLeft(1000, 11_000, 2)).toBe(60_000 - 6_000 - 10_000)
    expect(sprintTimeLeft(1000, 31_000, 0, 20_000)).toBe(50_000)
    expect(sprintTimeLeft(0, 70_000, 0)).toBe(0)
  })

  it('Uhr steht im Hintergrund', () => {
    let c = startClock(1000)
    c = clockReducer(c, { type: 'tick', now: 11_000 })
    expect(clockLeft(c, 1)).toBe(60_000 - 10_000 - 3_000)
    c = clockReducer(c, { type: 'hide', now: 12_000 })
    c = clockReducer(c, { type: 'tick', now: 90_000 })
    expect(clockLeft(c, 1)).toBe(60_000 - 11_000 - 3_000)
    c = clockReducer(c, { type: 'show', now: 100_000 })
    c = clockReducer(c, { type: 'tick', now: 101_000 })
    expect(clockLeft(c, 1)).toBe(60_000 - 12_000 - 3_000)
  })
})

describe('Sprint-Highscores', () => {
  it('je Auswahl getrennt, nur bessere zählen', async () => {
    const database = new DeckDB(`sp-${Math.random()}`)
    expect(await submitSprintScore('all', 12, database)).toBe(true)
    expect(await submitSprintScore('all', 10, database)).toBe(false)
    expect(await submitSprintScore('heroes', 5, database)).toBe(true)
    expect(await submitSprintScore('all', 15, database)).toBe(true)
    expect(await getSprintHighscores(database)).toEqual({ all: 15, heroes: 5 })
  })
})
