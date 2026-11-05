import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createBackup, parseBackup, restoreBackup } from './backup'
import { DeckDB, getQuizHighscore, getSettings, saveSettings, submitQuizScore } from './db'
import { rateCard } from '../srs/srs'

describe('Backup', () => {
  it('überlebt Export → JSON → Import inkl. Datumswerte', async () => {
    const src = new DeckDB(`b-${Math.random()}`)
    await rateCard('item:x', true, new Date('2026-11-05T12:00:00'), src)
    await saveSettings({ dailyGoal: 33, newPerDay: 5, slots: ['spirit'], quizKinds: ['number'] }, src)
    await submitQuizScore(870, src)
    const json = JSON.stringify(await createBackup(src))

    const dst = new DeckDB(`b-${Math.random()}`)
    await rateCard('item:other', true, new Date(), dst)
    await restoreBackup(parseBackup(json), dst)

    const reviews = await dst.reviews.toArray()
    expect(reviews.map(r => r.id)).toEqual(['item:x'])
    expect(reviews[0].due).toBeInstanceOf(Date)
    expect((await getSettings(dst)).dailyGoal).toBe(33)
    expect((await getSettings(dst)).quizKinds).toEqual(['number'])
    expect(await getQuizHighscore(dst)).toBe(870)
  })

  it('ergänzt fehlende neue Einstellungen aus alten Backups mit Standardwerten', async () => {
    const dst = new DeckDB(`b-${Math.random()}`)
    const old = JSON.stringify({
      app: 'deadlockdeck', version: 1, exportedAt: new Date().toISOString(),
      settings: { dailyGoal: 15, newPerDay: 3, slots: ['weapon'] }, reviews: [], days: [],
    })
    await restoreBackup(parseBackup(old), dst)
    const s = await getSettings(dst)
    expect(s.dailyGoal).toBe(15)
    expect(s.quizKinds).toEqual(['image', 'description', 'number', 'build'])
  })

  it('lehnt fremde Dateien ab', () => {
    expect(() => parseBackup('{"foo":1}')).toThrow(/keine DeadlockDeck/)
    expect(() => parseBackup('nope')).toThrow(/kein gültiges JSON/)
  })
})
