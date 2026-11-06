import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createBackup, parseBackup, restoreBackup } from './backup'
import { DeckDB, getBuildBests, getGuessHighscore, getQuizHighscore, getSettings, saveSettings, submitBuildResult, submitGuessScore, submitQuizScore } from './db'
import { QUIZ_KINDS } from './model'
import { rateCard } from '../srs/srs'

describe('Backup', () => {
  it('überlebt Export → JSON → Import inkl. Datumswerte', async () => {
    const src = new DeckDB(`b-${Math.random()}`)
    await rateCard('item:x', true, new Date('2026-11-05T12:00:00'), src)
    await saveSettings({ dailyGoal: 33, newPerDay: 5, slots: ['spirit'], quizKinds: ['number'], knownQuizKinds: [...QUIZ_KINDS], guessKinds: ['zoom'] }, src)
    await submitQuizScore(870, src)
    await submitGuessScore(640, src)
    await submitBuildResult('typical:13', { errors: 1, ms: 72_000 }, src)
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
    expect(await getGuessHighscore(dst)).toBe(640)
    expect((await getSettings(dst)).guessKinds).toEqual(['zoom'])
    expect((await getBuildBests(dst))['typical:13']).toMatchObject({ errors: 1, ms: 72_000 })
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
    expect(s.quizKinds).toEqual(['image', 'description', 'number', 'build', 'counterItem', 'counterHero'])
    expect(s.guessKinds).toEqual(['silhouette', 'zoom', 'blur', 'ability'])
  })

  it('schaltet bei alten Backups mit eigener Auswahl die neuen Counter-Fragen ein', async () => {
    const dst = new DeckDB(`b-${Math.random()}`)
    const old = JSON.stringify({
      app: 'deadlockdeck', version: 1, exportedAt: new Date().toISOString(),
      settings: { dailyGoal: 15, newPerDay: 3, slots: ['weapon'], quizKinds: ['image', 'build'] }, reviews: [], days: [],
    })
    await restoreBackup(parseBackup(old), dst)
    expect((await getSettings(dst)).quizKinds).toEqual(['image', 'build', 'counterItem', 'counterHero'])
  })

  it('lehnt fremde Dateien ab', () => {
    expect(() => parseBackup('{"foo":1}')).toThrow(/keine DeadlockDeck/)
    expect(() => parseBackup('nope')).toThrow(/kein gültiges JSON/)
  })
})
