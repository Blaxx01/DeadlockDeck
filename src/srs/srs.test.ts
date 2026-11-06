import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { State } from 'ts-fsrs'
import { DeckDB } from '../data/db'
import { deckOfCardId, newIntroducedToday } from '../decks'
import { afterRating, buildQueue, computeStreak, describeLearnState, formatRelative, isInLearnScope, localDate, rateCard, requestLearn, requeue } from './srs'

const now = new Date('2026-11-05T12:00:00')
const past = new Date('2026-11-04T12:00:00')
const future = new Date('2026-11-09T12:00:00')

describe('buildQueue', () => {
  const cards = [
    { id: 'a', order: 2 }, { id: 'b', order: 1 }, { id: 'c', order: 1 },
    { id: 'd', order: 3 }, { id: 'e', order: 1 },
  ]
  const reviews = new Map([
    ['d', { due: new Date('2026-11-05T08:00:00') }],
    ['e', { due: past }],
    ['a', { due: future }],
  ])

  it('zeigt fällige zuerst (älteste zuerst), dann neue nach Tier, mit Limit', () => {
    const q = buildQueue({ cards, reviews, now, newLimit: 1, rng: () => 0.5 })
    expect(q).toEqual(['e', 'd', 'b'])
  })

  it('ignoriert negative Limits', () => {
    expect(buildQueue({ cards, reviews, now, newLimit: -3 })).toEqual(['e', 'd'])
  })
})

describe('afterRating', () => {
  it('gewusst: Karte ist für die Session erledigt', () => {
    expect(afterRating(['a', 'b', 'c'], 'a', true)).toEqual({ queue: ['b', 'c'], deferred: false })
  })
  it('nicht gewusst: kommt nach ein paar anderen Karten wieder', () => {
    expect(afterRating(['a', 'b', 'c', 'd', 'e'], 'a', false)).toEqual({ queue: ['b', 'c', 'd', 'a', 'e'], deferred: false })
    expect(afterRating(['a', 'b'], 'a', false)).toEqual({ queue: ['b', 'a'], deferred: false })
  })
  it('nicht gewusst und letzte Karte: Session endet, Karte kommt später wieder', () => {
    expect(afterRating(['a'], 'a', false)).toEqual({ queue: [], deferred: true })
    expect(afterRating(['a'], 'a', true)).toEqual({ queue: [], deferred: false })
  })
})

describe('requeue', () => {
  it('schiebt die Karte ein paar Plätze nach hinten', () => {
    expect(requeue(['x', 'a', 'b', 'c', 'd'], 'x')).toEqual(['a', 'b', 'c', 'x', 'd'])
    expect(requeue(['x', 'a'], 'x')).toEqual(['a', 'x'])
    expect(requeue(['x'], 'x')).toEqual(['x'])
  })
})

describe('computeStreak', () => {
  const day = (date: string, reviewed: number) => ({ date, reviewed, newIntroduced: 0 })
  it('zählt Tage in Folge, heute zählt erst bei erreichtem Ziel', () => {
    const days = [day('2026-11-02', 25), day('2026-11-03', 20), day('2026-11-04', 30), day('2026-11-05', 5)]
    expect(computeStreak(days, 20, now)).toBe(3)
    expect(computeStreak([...days.slice(0, 3), day('2026-11-05', 20)], 20, now)).toBe(4)
  })
  it('bricht bei einer Lücke ab', () => {
    expect(computeStreak([day('2026-11-02', 25), day('2026-11-04', 25)], 20, now)).toBe(1)
    expect(computeStreak([], 20, now)).toBe(0)
  })
})

describe('rateCard', () => {
  it('speichert die Bewertung und zählt fürs Tagesziel', async () => {
    const database = new DeckDB(`test-${Math.random()}`)
    const r1 = await rateCard('item:a', false, now, database)
    expect(r1.wasNew).toBe(true)
    expect(r1.due.getTime() - now.getTime()).toBeLessThan(15 * 60_000)

    const stored = await database.reviews.get('item:a')
    expect(stored?.state).toBe(State.Learning)
    expect(stored?.lapses).toBe(0)

    const later = new Date(now.getTime() + 10 * 60_000)
    await rateCard('item:a', true, later, database)
    const day = await database.days.get(localDate(now))
    // dieselbe Karte zählt nur einmal fürs Tagesziel
    expect(day).toMatchObject({ reviewed: 1, newIntroduced: 1, cards: ['item:a'] })
  })

  it('immer wieder „nicht gewusst“ auf derselben Karte trickst das Tagesziel nicht aus', async () => {
    const database = new DeckDB(`t-${Math.random()}`)
    let t = now
    for (let i = 0; i < 10; i++) {
      await rateCard('item:last', false, t, database)
      t = new Date(t.getTime() + 2 * 60_000)
    }
    await rateCard('item:other', true, t, database)
    expect(await database.days.get(localDate(now))).toMatchObject({ reviewed: 2 })
  })

  it('plant gewusste Review-Karten weiter in die Zukunft', async () => {
    const database = new DeckDB(`test-${Math.random()}`)
    let t = now
    for (let i = 0; i < 4; i++) {
      const r = await rateCard('item:b', true, t, database)
      t = r.due
    }
    const stored = await database.reviews.get('item:b')
    expect(stored?.state).toBe(State.Review)
    expect(stored!.due.getTime() - now.getTime()).toBeGreaterThan(3 * 86400_000)
  })
})

describe('Jetzt lernen', () => {
  it('macht neue Karten sofort fällig, ohne das Neu-Limit zu belasten', async () => {
    const database = new DeckDB(`r-${Math.random()}`)
    await requestLearn('item:new', now, database)
    const rec = await database.reviews.get('item:new')
    expect(rec?.requested).toBe(true)
    expect(rec?.state).toBe(State.New)
    expect(rec?.due.getTime()).toBe(now.getTime())

    // erscheint bei den fälligen Karten, nicht bei den neuen
    const q = buildQueue({ cards: [{ id: 'item:new', order: 1 }], reviews: new Map([['item:new', rec!]]), now, newLimit: 0 })
    expect(q).toEqual(['item:new'])

    await rateCard('item:new', true, now, database)
    const after = await database.reviews.get('item:new')
    expect(after?.requested).toBeUndefined()
    expect(await database.days.get(localDate(now))).toMatchObject({ reviewed: 1, newIntroduced: 0 })
  })

  it('behält den Lernverlauf gelernter Karten', async () => {
    const database = new DeckDB(`r-${Math.random()}`)
    let t = now
    for (let i = 0; i < 4; i++) t = (await rateCard('item:old', true, t, database)).due
    const before = await database.reviews.get('item:old')
    await requestLearn('item:old', now, database)
    const rec = await database.reviews.get('item:old')
    expect(rec).toMatchObject({ requested: true, reps: before!.reps, stability: before!.stability, state: State.Review })
    expect(rec!.due.getTime()).toBe(now.getTime())
  })

  it('vorgemerkte Karten gehören trotz ausgeblendeter Kategorie zur Session', () => {
    expect(isInLearnScope(false, { requested: true })).toBe(true)
    expect(isInLearnScope(false, undefined)).toBe(false)
    expect(isInLearnScope(true, undefined)).toBe(true)
  })
})

describe('Lernstand-Text', () => {
  it('beschreibt neue, vorgemerkte und gelernte Karten', async () => {
    expect(describeLearnState(undefined, now).label).toBe('Neu')
    const database = new DeckDB(`l-${Math.random()}`)
    let t = now
    for (let i = 0; i < 4; i++) t = (await rateCard('item:x', true, t, database)).due
    const rec = (await database.reviews.get('item:x'))!
    const state = describeLearnState(rec, now)
    expect(state.label).toBe('Gelernt')
    expect(state.detail).toMatch(/^nächste Wiederholung in \d+ (Tagen|Wochen) · 4× wiederholt$/)
    expect(describeLearnState({ ...rec, requested: true }, now).label).toBe('Vorgemerkt')
    expect(describeLearnState(rec, new Date(rec.due.getTime() + 1000)).detail).toMatch(/^jetzt fällig/)
  })

  it('formatiert Abstände', () => {
    const at = (ms: number) => new Date(now.getTime() + ms)
    expect(formatRelative(at(5 * 60_000), now)).toBe('in 5 Min.')
    expect(formatRelative(at(3 * 3600_000), now)).toBe('in 3 Std.')
    expect(formatRelative(at(24 * 3600_000), now)).toBe('morgen')
    expect(formatRelative(at(5 * 86_400_000), now)).toBe('in 5 Tagen')
    expect(formatRelative(at(21 * 86_400_000), now)).toBe('in 3 Wochen')
    expect(formatRelative(at(90 * 86_400_000), now)).toBe('in 3 Monaten')
  })
})

describe('Decks', () => {
  it('ordnet Karten-IDs ihrem Deck zu', () => {
    expect(deckOfCardId('item:upgrade_x')).toBe('items')
    expect(deckOfCardId('ability:ability_sleep_dagger')).toBe('abilities')
    expect(deckOfCardId('hero:hero_haze')).toBe('heroes')
  })

  it('zählt neue Karten je Deck – auch an Tagen von vor den Hero-Decks', async () => {
    const database = new DeckDB(`d-${Math.random()}`)
    // Tag von vor dem Update: 3 neue Items, noch ohne newByDeck
    await database.days.put({ date: localDate(now), reviewed: 3, newIntroduced: 3 })
    expect(newIntroducedToday(await database.days.get(localDate(now)), 'items')).toBe(3)
    expect(newIntroducedToday(await database.days.get(localDate(now)), 'heroes')).toBe(0)

    await rateCard('hero:hero_haze', true, now, database)
    await rateCard('ability:ability_a', false, now, database)
    await rateCard('ability:ability_b', true, now, database)
    await rateCard('ability:ability_a', true, now, database) // keine neue Karte mehr, zählt auch nicht nochmal
    const day = await database.days.get(localDate(now))
    expect(day).toMatchObject({ reviewed: 6, newIntroduced: 6, newByDeck: { items: 3, heroes: 1, abilities: 2 } })
    expect(newIntroducedToday(day, 'abilities')).toBe(2)
    expect(newIntroducedToday(undefined, 'items')).toBe(0)
  })
})
