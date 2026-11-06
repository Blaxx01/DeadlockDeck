import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { DeckDB, getQuizHighscore, getSettings, saveSettings, setMeta, submitQuizScore } from './db'
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

describe('Einstellungen: neue Fragetypen', () => {
  it('schaltet neue Fragetypen bei alten Einstellungen ein, respektiert aber später abgewählte', async () => {
    const database = new DeckDB(`q-${Math.random()}`)
    // Gespeichert vor den Counter-Fragen: nur „Bild“ gewählt, ohne knownQuizKinds
    await setMeta('settings', { dailyGoal: 20, newPerDay: 10, slots: ['spirit'], quizKinds: ['image'] }, database)
    const migrated = await getSettings(database)
    expect(migrated.quizKinds).toEqual(['image', 'counterItem', 'counterHero', 'upgrade', 'effect'])

    // Danach Counter abgewählt und gespeichert → bleibt aus
    await saveSettings({ ...migrated, quizKinds: ['image'] }, database)
    expect((await getSettings(database)).quizKinds).toEqual(['image'])
  })

  it('alte Einstellungen fragen „Gelerntes zuerst“', async () => {
    const database = new DeckDB(`q-${Math.random()}`)
    await setMeta('settings', { dailyGoal: 20, newPerDay: 10, slots: ['spirit'], quizKinds: ['image'] }, database)
    expect((await getSettings(database)).quizScope).toBe('learned-first')
    await saveSettings({ ...(await getSettings(database)), quizScope: 'all' }, database)
    expect((await getSettings(database)).quizScope).toBe('all')
  })

  it('Upgrade- und Effekt-Fragen kommen bei Einstellungen von vor ihnen dazu, abgewählte Counter bleiben aus', async () => {
    const database = new DeckDB(`q-${Math.random()}`)
    const before = ['image', 'description', 'number', 'build', 'counterItem', 'counterHero']
    await setMeta('settings', { dailyGoal: 20, newPerDay: 10, slots: ['spirit'], quizKinds: ['image', 'number'], knownQuizKinds: before }, database)
    expect((await getSettings(database)).quizKinds).toEqual(['image', 'number', 'upgrade', 'effect'])
  })
})
