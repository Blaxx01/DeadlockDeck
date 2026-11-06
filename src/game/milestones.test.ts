import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createEmptyCard, State } from 'ts-fsrs'
import { DeckDB, getMeta, submitBuildResult } from '../data/db'
import { rateCard } from '../srs/srs'
import { item } from '../test/counterFixtures'
import { abilityCards, counterCard, fullHero, review } from '../test/masteryFixtures'
import {
  checkAllMilestones, checkCardMilestones, checkHeroStars, GOLD_SOULS, markGuessClean, milestoneSouls, SILVER_SOULS, STAR_SOULS,
  type StarMap,
} from './milestones'
import { getSoulsTotal, lastActiveDate, soulsEvents } from './souls'

const at = (d: number, h = 12) => new Date(2026, 10, d, h)
const haze = fullHero(13, 'Haze')

async function setup() {
  const database = new DeckDB(`ms-${Math.random()}`)
  await database.items.bulkPut([item(1, 'Item 1'), item(2, 'Item 2')])
  await database.heroes.put(haze)
  await database.abilities.bulkPut(abilityCards(haze))
  await database.counters.put(counterCard(haze))
  return database
}

/** Mitschnitt der Souls-Ereignisse (Animationen) */
function recordEvents() {
  const seen: number[] = []
  const listener = (e: Event) => seen.push((e as CustomEvent<{ amount: number }>).detail.amount)
  soulsEvents.addEventListener('souls', listener)
  return { seen, stop: () => soulsEvents.removeEventListener('souls', listener) }
}

describe('milestoneSouls', () => {
  it('Silber +25, Gold +50, direkt Gold beides – jede Stufe nur einmal', () => {
    expect(milestoneSouls(undefined, 'bronze')).toBe(0)
    expect(milestoneSouls(undefined, 'silver')).toBe(SILVER_SOULS)
    expect(milestoneSouls(undefined, 'gold')).toBe(SILVER_SOULS + GOLD_SOULS)
    expect(milestoneSouls('silver', 'gold')).toBe(GOLD_SOULS)
    expect(milestoneSouls('silver', 'silver')).toBe(0)
    expect(milestoneSouls('gold', 'silver')).toBe(0)
    expect(milestoneSouls('gold', 'gold')).toBe(0)
  })
})

describe('Meilenstein-Souls für Karten', () => {
  it('erstmals Silber, dann Gold; vergessen und wieder gefestigt bringt nichts mehr', async () => {
    const database = await setup()
    await database.reviews.put(review('item:item_1', 25))
    const silver = await checkCardMilestones(['item:item_1'], at(6), database)
    expect(silver.map(g => [g.amount, g.reason, g.label])).toEqual([[25, 'milestone', '🥈 Silber']])
    expect(await checkCardMilestones(['item:item_1'], at(6), database)).toEqual([])

    await database.reviews.put(review('item:item_1', 80))
    expect((await checkCardMilestones(['item:item_1'], at(7), database)).map(g => [g.amount, g.label])).toEqual([[50, '🥇 Gold']])

    await database.reviews.put(review('item:item_1', 0, State.Relearning))
    await checkCardMilestones(['item:item_1'], at(8), database)
    await database.reviews.put(review('item:item_1', 90))
    expect(await checkCardMilestones(['item:item_1'], at(9), database)).toEqual([])
    expect(await getSoulsTotal(database)).toBe(75)
    const entry = (await database.souls.toArray())[0]
    expect(entry).toMatchObject({ date: '2026-11-06', reason: 'milestone', data: { card: 'item:item_1', level: 'silver' } })
  })

  it('wird nach jeder Bewertung geprüft (rateCard)', async () => {
    const database = await setup()
    // gut gefestigte Karte: nach „gewusst“ ist die nächste Wiederholung Monate entfernt
    const card = { ...createEmptyCard(at(1)), state: State.Review, stability: 200, difficulty: 4, reps: 5, scheduled_days: 15, last_review: at(1), due: at(5) }
    await database.reviews.put({ ...card, id: 'item:item_2' })
    const result = await rateCard('item:item_2', true, at(6), database)
    expect(result.milestones.map(g => [g.amount, g.label])).toEqual([[SILVER_SOULS + GOLD_SOULS, '🥇 Gold']])
    // +10 für die Karte, +75 Meilenstein
    expect(await getSoulsTotal(database)).toBe(10 + 75)
  })
})

describe('Hero-Sterne', () => {
  it('je neuer Stern +100: Hero-Karte, Fähigkeiten, Counter, Build-Quiz (Typisch), Hero erraten', async () => {
    const database = await setup()
    // Hero-Karte Silber: Meilenstein + Stern
    await database.reviews.put(review('hero:hero_haze', 30))
    const gains = await checkCardMilestones(['hero:hero_haze'], at(6), database)
    expect(gains.map(g => [g.reason, g.amount, g.label])).toEqual([['milestone', 25, '🥈 Silber'], ['star', 100, '★ Haze']])

    // 3 von 4 Fähigkeiten reichen nicht
    for (const a of haze.abilities.slice(0, 3)) await database.reviews.put(review(a.id, 22))
    expect((await checkCardMilestones(haze.abilities.slice(0, 3).map(a => a.id), at(6), database)).filter(g => g.reason === 'star')).toEqual([])
    await database.reviews.put(review(haze.abilities[3].id, 22))
    expect((await checkCardMilestones([haze.abilities[3].id], at(6), database)).map(g => g.reason)).toEqual(['milestone', 'star'])

    await database.reviews.put(review('counter:hero_haze', 21))
    expect((await checkCardMilestones(['counter:hero_haze'], at(6), database)).map(g => g.reason)).toEqual(['milestone', 'star'])

    // Community-Build zählt nicht, typischer Build ohne Fehler schon
    await submitBuildResult('community:13', { errors: 0, ms: 1000 }, database)
    expect(await checkHeroStars([13], at(6), database)).toEqual([])
    await submitBuildResult('typical:13', { errors: 0, ms: 1000 }, database)
    expect((await checkHeroStars([13], at(6), database)).map(g => g.amount)).toEqual([STAR_SOULS])

    expect((await markGuessClean('hero:hero_haze', at(6), database)).map(g => g.amount)).toEqual([STAR_SOULS])
    expect(await markGuessClean('hero:hero_haze', at(6), database)).toEqual([])

    expect(await getMeta<StarMap>('heroStars', {}, database)).toEqual({ 'hero:hero_haze': ['hero', 'abilities', 'counter', 'build', 'guess'] })
    expect(await getMeta<string[]>('guessClean', [], database)).toEqual(['hero:hero_haze'])
    // 6 Karten Silber (Hero, 4 Fähigkeiten, Counter) + 5 Sterne
    expect(await getSoulsTotal(database)).toBe(6 * 25 + 5 * 100)

    // Stern verloren (Karte vergessen) und wiedergewonnen: keine Souls mehr
    await database.reviews.put(review('hero:hero_haze', 0, State.Relearning))
    await checkCardMilestones(['hero:hero_haze'], at(7), database)
    await database.reviews.put(review('hero:hero_haze', 40))
    expect(await checkCardMilestones(['hero:hero_haze'], at(8), database)).toEqual([])
  })
})

describe('Meilensteine beim Start nachträglich gutschreiben', () => {
  it('still, je ein Eintrag für Karten und Sterne; danach nichts mehr; zählt nicht als Lerntag', async () => {
    const database = await setup()
    await rateCard('item:item_1', true, at(1), database)
    await database.reviews.bulkPut([
      review('item:item_1', 30), review('item:item_2', 70), review('hero:hero_haze', 21), review('item:gone', 99),
    ])
    const events = recordEvents()
    const before = await getSoulsTotal(database)
    expect(await checkAllMilestones(at(6), database)).toBe(25 + 75 + 25 + 100)
    events.stop()
    expect(events.seen).toEqual([])
    expect(await getSoulsTotal(database)).toBe(before + 225)
    const entries = (await database.souls.toArray()).filter(e => e.reason === 'milestone' || e.reason === 'star')
    expect(entries.map(e => [e.reason, e.amount, e.data])).toEqual([
      ['milestone', 125, { retro: true, count: 3 }],
      ['star', 100, { retro: true, count: 1 }],
    ])
    expect(await checkAllMilestones(at(7), database)).toBe(0)
    // Lerntag bleibt der 1. – das Gutschreiben am 6. ist keine Aktivität
    expect(await lastActiveDate(database)).toBe('2026-11-01')
  })
})
