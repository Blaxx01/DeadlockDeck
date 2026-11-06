import { describe, expect, it } from 'vitest'
import { calendarWeeks, dayLevel, describeDay, learningTotals, niceStep, soulsSeries, weekStart } from './stats'

describe('Kalender der Lerntage', () => {
  it('Stufen: nichts, gelernt, Tagesziel, doppeltes Tagesziel', () => {
    expect([0, 1, 19, 20, 39, 40, 99].map(n => dayLevel(n, 20))).toEqual([0, 1, 1, 2, 2, 3, 3])
  })

  it('Wochen von Montag bis Sonntag bis zur aktuellen Woche; Zukunft leer, Schutz markiert', () => {
    // 2026-11-06 ist ein Freitag
    expect(weekStart('2026-11-06')).toBe('2026-11-02')
    expect(weekStart('2026-11-02')).toBe('2026-11-02')
    expect(weekStart('2026-11-08')).toBe('2026-11-02')
    const weeks = calendarWeeks(
      [{ date: '2026-11-06', reviewed: 25 }, { date: '2026-11-04', reviewed: 3 }, { date: '2026-10-26', reviewed: 41 }],
      20, '2026-11-06', ['2026-11-05'], 2,
    )
    expect(weeks).toHaveLength(2)
    expect(weeks[0][0].date).toBe('2026-10-26')
    expect(weeks[0][0].level).toBe(3)
    const now = weeks[1]
    expect(now.map(d => d.date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'])
    expect(now.map(d => d.level)).toEqual([0, 0, 1, 0, 2, 0, 0])
    expect(now.map(d => d.future)).toEqual([false, false, false, false, false, true, true])
    expect(now[3].shielded).toBe(true)
    expect(describeDay(now[4], 20)).toMatch(/: 25 Karten · Tagesziel ✓$/)
    expect(describeDay(now[3], 20)).toMatch(/: 0 Karten · 🛡 Streak-Schutz verbraucht$/)
  })

  it('zählt Lerntage, Tagesziele und Bewertungen', () => {
    expect(learningTotals([{ reviewed: 0 }, { reviewed: 5 }, { reviewed: 20 }, { reviewed: 31 }], 20)).toEqual({
      learningDays: 3, goalDays: 2, reviews: 56,
    })
  })
})

describe('Souls-Verlauf', () => {
  it('Stand am Ende jedes Tages vom ersten Eintrag bis heute, Tage ohne Einträge mitgezählt', () => {
    const series = soulsSeries([
      { date: '2026-11-03', amount: 100 }, { date: '2026-11-01', amount: 30 }, { date: '2026-11-03', amount: 25 },
      { date: '2026-11-04', amount: -50 },
    ], '2026-11-05')
    expect(series).toEqual([
      { date: '2026-11-01', total: 30, delta: 30 },
      { date: '2026-11-02', total: 30, delta: 0 },
      { date: '2026-11-03', total: 155, delta: 125 },
      { date: '2026-11-04', total: 105, delta: -50 },
      { date: '2026-11-05', total: 105, delta: 0 },
    ])
    expect(soulsSeries([], '2026-11-05')).toEqual([])
  })

  it('Achsen-Schritte 1, 2, 5 × 10ⁿ', () => {
    expect(niceStep(0)).toBe(1)
    expect(niceStep(90)).toBe(50)
    expect(niceStep(150)).toBe(50)
    expect(niceStep(1000)).toBe(500)
    expect(niceStep(3240)).toBe(2000)
    expect(niceStep(5)).toBe(2)
  })
})
