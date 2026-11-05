import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { DeckDB, getQuizHighscore, setMeta, submitQuizScore } from './db'
import { DATA_VERSION, needsAutoSync } from './sync'

describe('Quiz-Highscore', () => {
  it('speichert nur Verbesserungen', async () => {
    const database = new DeckDB(`h-${Math.random()}`)
    expect(await getQuizHighscore(database)).toBe(0)
    expect(await submitQuizScore(500, database)).toBe(true)
    expect(await submitQuizScore(400, database)).toBe(false)
    expect(await submitQuizScore(500, database)).toBe(false)
    expect(await getQuizHighscore(database)).toBe(500)
  })
})

describe('needsAutoSync', () => {
  it('lädt neu, wenn das Kartenformat veraltet ist – auch direkt nach einem Sync', async () => {
    const database = new DeckDB(`s-${Math.random()}`)
    await setMeta('lastSync', Date.now(), database)
    expect(await needsAutoSync(database)).toBe(true) // alte Daten ohne dataVersion
    await setMeta('dataVersion', DATA_VERSION, database)
    expect(await needsAutoSync(database)).toBe(false)
    await setMeta('lastSync', Date.now() - 25 * 3600_000, database)
    expect(await needsAutoSync(database)).toBe(true)
  })
})
