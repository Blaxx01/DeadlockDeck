import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { DeckDB, getMeta, saveSettings, getSettings, setMeta } from '../data/db'
import { localDate } from '../data/dates'
import { rateCard } from '../srs/srs'
import { applyDecay, awardRound, CARD_SOULS, decayDates, getSoulsTotal, GOAL_SOULS, lastActiveDate, roundSouls, seedSoulsFromHistory } from './souls'

const newDb = () => new DeckDB(`souls-${Math.random()}`)
const at = (d: number, h = 12) => new Date(2026, 10, d, h)

describe('roundSouls', () => {
  it('die ersten 3 Runden voll, danach ¼', () => {
    expect(roundSouls(124, 0)).toBe(124)
    expect(roundSouls(124.4, 2)).toBe(124)
    expect(roundSouls(124, 3)).toBe(31)
    expect(roundSouls(-5, 0)).toBe(0)
  })
})

describe('Souls für Karten und Runden', () => {
  it('+10 je Karte und Tag – gewusst oder nicht, Wiederholungen derselben Karte zählen nicht', async () => {
    const database = newDb()
    await rateCard('item:a', false, at(5, 10), database)
    await rateCard('item:a', true, at(5, 11), database)
    await rateCard('item:b', true, at(5, 12), database)
    expect(await getSoulsTotal(database)).toBe(2 * CARD_SOULS)
    // ein Eintrag pro Tag für alle Karten
    expect(await database.souls.where('reason').equals('card').toArray()).toMatchObject([{ amount: 20, data: { count: 2 } }])
    await rateCard('item:a', true, at(6), database)
    expect(await getSoulsTotal(database)).toBe(3 * CARD_SOULS)
  })

  it('Tagesziel-Bonus einmal pro Tag', async () => {
    const database = newDb()
    await saveSettings({ ...(await getSettings(database)), dailyGoal: 2 }, database)
    await rateCard('item:a', true, at(5), database)
    await rateCard('item:b', true, at(5), database)
    await rateCard('item:c', true, at(5), database)
    const goal = await database.souls.where('reason').equals('goal').toArray()
    expect(goal).toHaveLength(1)
    expect(await getSoulsTotal(database)).toBeGreaterThanOrEqual(3 * CARD_SOULS + GOAL_SOULS)
  })

  it('je Modus und Tag: Runden 1–3 voll, ab der 4. ein Viertel', async () => {
    const database = newDb()
    const amounts = []
    for (let i = 0; i < 5; i++) amounts.push((await awardRound('quiz', 100, { score: 1000 }, at(5), database)).amount)
    expect(amounts).toEqual([100, 100, 100, 25, 25])
    // anderer Modus und anderer Tag zählen getrennt
    expect((await awardRound('build', 100, {}, at(5), database)).amount).toBe(100)
    expect((await awardRound('quiz', 100, {}, at(6), database)).amount).toBe(100)
  })
})

describe('Rang-Verfall', () => {
  it('ab dem 6. Tag ohne Lernen, nur vergangene Tage', () => {
    expect(decayDates('2026-11-01', '2026-11-07')).toEqual([])
    expect(decayDates('2026-11-01', '2026-11-08')).toEqual(['2026-11-07'])
    expect(decayDates('2026-11-01', '2026-11-10')).toEqual(['2026-11-07', '2026-11-08', '2026-11-09'])
  })

  it('bucht −50 je Tag einmal, nie unter 0, und stoppt nach dem nächsten Lerntag', async () => {
    const database = newDb()
    await awardRound('quiz', 120, {}, at(1), database)
    expect(await applyDecay(at(9), database)).toBe(100) // 7. und 8. → 2 × 50
    expect(await applyDecay(at(9), database)).toBe(0) // schon gebucht
    expect(await getSoulsTotal(database)).toBe(20)
    expect(await applyDecay(at(12), database)).toBe(20) // nie unter 0
    expect(await getSoulsTotal(database)).toBe(0)

    await awardRound('quiz', 80, {}, at(12), database)
    expect(await lastActiveDate(database)).toBe('2026-11-12')
    expect(await applyDecay(at(15), database)).toBe(0)
  })

  it('zählt erst ab dem Start der Souls-Funktion', async () => {
    const database = newDb()
    await awardRound('quiz', 300, {}, at(1), database)
    await setMeta('soulsStart', '2026-11-10', database)
    expect(await applyDecay(at(14), database)).toBe(0)
    expect(await applyDecay(at(17), database)).toBe(50) // der 16. ist der 6. Tag nach dem Start, am 17. vorbei
  })
})

describe('Rückwirkende Gutschrift', () => {
  it('schreibt bisheriges Lernen einmalig gut', async () => {
    const database = newDb()
    await database.days.bulkPut([
      { date: '2026-10-01', reviewed: 25, newIntroduced: 3 },
      { date: '2026-10-02', reviewed: 5, newIntroduced: 0 },
    ])
    expect(await seedSoulsFromHistory(20, database)).toBe(250 + 100 + 50)
    expect(await seedSoulsFromHistory(20, database)).toBe(0)
    expect(await getSoulsTotal(database)).toBe(400)
    expect(await getMeta('soulsStart', '', database)).toBe(localDate())
  })
})
