import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createBackup, parseBackup, restoreBackup } from './backup'
import { DeckDB, getBuildBests, getGuessHighscore, getMeta, getQuizHighscore, getSettings, saveSettings, submitBuildResult, submitGuessScore, submitQuizScore } from './db'
import { QUIZ_KINDS } from './model'
import { rateCard } from '../srs/srs'
import { awardRound, getSoulsTotal } from '../game/souls'
import { logMistake } from '../game/weakness'
import { checkAllMilestones } from '../game/milestones'
import { item } from '../test/counterFixtures'
import { review } from '../test/masteryFixtures'

describe('Backup', () => {
  it('überlebt Export → JSON → Import inkl. Datumswerte', async () => {
    const src = new DeckDB(`b-${Math.random()}`)
    await rateCard('item:x', true, new Date('2026-11-05T12:00:00'), src)
    await saveSettings({ dailyGoal: 33, newPerDay: 5, slots: ['spirit'], quizKinds: ['number'], knownQuizKinds: [...QUIZ_KINDS], guessKinds: ['zoom'], effects: false, typeAnswers: ['counters'], quizScope: 'learned-only', mapGroups: ['camps'], mapQuestionTypes: ['what'], introNew: false }, src)
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
    expect((await getSettings(dst)).typeAnswers).toEqual(['counters'])
    expect((await getSettings(dst)).quizScope).toBe('learned-only')
    expect((await getSettings(dst)).mapGroups).toEqual(['camps'])
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
    expect(s.quizKinds).toEqual(['image', 'description', 'number', 'build', 'counterItem', 'counterHero', 'upgrade', 'effect'])
    expect(s.guessKinds).toEqual(['silhouette', 'zoom', 'blur', 'ability'])
  })

  it('schaltet bei alten Backups mit eigener Auswahl die neuen Counter-Fragen ein', async () => {
    const dst = new DeckDB(`b-${Math.random()}`)
    const old = JSON.stringify({
      app: 'deadlockdeck', version: 1, exportedAt: new Date().toISOString(),
      settings: { dailyGoal: 15, newPerDay: 3, slots: ['weapon'], quizKinds: ['image', 'build'] }, reviews: [], days: [],
    })
    await restoreBackup(parseBackup(old), dst)
    expect((await getSettings(dst)).quizKinds).toEqual(['image', 'build', 'counterItem', 'counterHero', 'upgrade', 'effect'])
  })

  it('nimmt den Souls-Verlauf mit; alte Backups ohne Souls werden aus der Tageshistorie neu berechnet', async () => {
    const src = new DeckDB(`b-${Math.random()}`)
    await rateCard('item:x', true, new Date(2026, 10, 5, 12), src)
    await awardRound('quiz', 120, { score: 1200, correct: 9 }, new Date(2026, 10, 5, 13), src)
    await logMistake('item:x', 'quiz', new Date(2026, 10, 5, 14), src)
    const json = JSON.stringify(await createBackup(src))
    const dst = new DeckDB(`b-${Math.random()}`)
    await awardRound('build', 999, {}, new Date(), dst) // wird ersetzt
    await restoreBackup(parseBackup(json), dst)
    expect(await getSoulsTotal(dst)).toBe(130)
    expect((await dst.souls.toArray()).map(e => e.reason).sort()).toEqual(['card', 'quiz'])
    expect((await dst.mistakes.toArray()).map(e => [e.cardId, e.source])).toEqual([['item:x', 'quiz']])

    const old = JSON.stringify({
      app: 'deadlockdeck', version: 1, exportedAt: new Date().toISOString(), settings: { dailyGoal: 2, newPerDay: 3, slots: ['weapon'] },
      reviews: [], days: [{ date: '2026-10-01', reviewed: 3, newIntroduced: 3 }],
    })
    await restoreBackup(parseBackup(old), dst)
    expect(await getSoulsTotal(dst)).toBe(3 * 10 + 100)
  })

  it('nimmt Meilensteine mit (keine doppelten Souls); alte Backups ohne Meilensteine werden neu berechnet', async () => {
    const src = new DeckDB(`b-${Math.random()}`)
    await src.items.put(item(1, 'Item 1'))
    await src.reviews.put(review('item:item_1', 30))
    await checkAllMilestones(new Date(2026, 10, 5), src)
    await src.meta.put({ key: 'guessClean', value: ['hero:hero_haze'] })
    const backup = await createBackup(src)
    expect(backup.milestones).toEqual({ 'item:item_1': 'silver' })
    expect(backup.guessClean).toEqual(['hero:hero_haze'])

    const dst = new DeckDB(`b-${Math.random()}`)
    await dst.items.put(item(1, 'Item 1'))
    await restoreBackup(parseBackup(JSON.stringify(backup)), dst)
    expect(await getSoulsTotal(dst)).toBe(25)
    expect(await getMeta('milestones', {}, dst)).toEqual({ 'item:item_1': 'silver' })
    expect(await getMeta('guessClean', [], dst)).toEqual(['hero:hero_haze'])

    const old = JSON.stringify({
      app: 'deadlockdeck', version: 1, exportedAt: new Date().toISOString(), settings: { dailyGoal: 20, newPerDay: 3, slots: ['weapon'] },
      reviews: [review('item:item_1', 70)], days: [],
    })
    await restoreBackup(parseBackup(old), dst)
    // Silber + Gold neu berechnet; der erratene Hero gehörte nicht zu diesem Backup
    expect(await getSoulsTotal(dst)).toBe(75)
    expect(await getMeta('guessClean', [], dst)).toEqual([])
  })

  it('nimmt den Start des Lane-Angriffs mit (Siege und Niederlagen kommen aus dem Souls-Verlauf)', async () => {
    const src = new DeckDB(`b-${Math.random()}`)
    await awardRound('quiz', 120, { score: 1200, correct: 9 }, new Date(2026, 10, 5, 13), src)
    await src.meta.put({ key: 'laneStart', value: '2026-11-04' })
    const json = JSON.stringify(await createBackup(src))
    const dst = new DeckDB(`b-${Math.random()}`)
    await dst.meta.put({ key: 'laneStart', value: '2026-11-20' })
    await restoreBackup(parseBackup(json), dst)
    expect(await getMeta('laneStart', null, dst)).toBe('2026-11-04')
    // alte Backups ohne: der Start auf dem Gerät bleibt
    const old = JSON.stringify({ app: 'deadlockdeck', version: 1, exportedAt: new Date().toISOString(), settings: { dailyGoal: 20 }, reviews: [], days: [] })
    await restoreBackup(parseBackup(old), dst)
    expect(await getMeta('laneStart', null, dst)).toBe('2026-11-04')
  })

  it('nimmt den höchsten Kontostand mit (Missions-Stufen); ohne Angabe aus dem Verlauf', async () => {
    const src = new DeckDB(`b-${Math.random()}`)
    await awardRound('quiz', 120, { score: 1200, correct: 9 }, new Date(2026, 10, 5, 13), src)
    await src.meta.put({ key: 'soulsBest', value: 13_000 })
    const backup = await createBackup(src)
    expect(backup.soulsBest).toBe(13_000)
    const dst = new DeckDB(`b-${Math.random()}`)
    await restoreBackup(parseBackup(JSON.stringify(backup)), dst)
    expect(await getMeta('soulsBest', null, dst)).toBe(13_000)
    // ohne Angabe: Höchststand aus dem Verlauf
    const { soulsBest: _ignored, ...older } = backup
    const souls = [{ id: 1, at: 1, date: '2026-11-01', amount: 900, reason: 'quiz' }, { id: 2, at: 2, date: '2026-11-08', amount: -300, reason: 'decay' }]
    await restoreBackup(parseBackup(JSON.stringify({ ...older, souls })), dst)
    expect(await getSoulsTotal(dst)).toBe(600)
    expect(await getMeta('soulsBest', null, dst)).toBe(900)
  })

  it('lehnt fremde Dateien ab', () => {
    expect(() => parseBackup('{"foo":1}')).toThrow(/keine DeadlockDeck/)
    expect(() => parseBackup('nope')).toThrow(/kein gültiges JSON/)
  })
})
