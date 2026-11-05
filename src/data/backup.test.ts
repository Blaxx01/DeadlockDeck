import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createBackup, parseBackup, restoreBackup } from './backup'
import { DeckDB, getSettings, saveSettings } from './db'
import { rateCard } from '../srs/srs'

describe('Backup', () => {
  it('überlebt Export → JSON → Import inkl. Datumswerte', async () => {
    const src = new DeckDB(`b-${Math.random()}`)
    await rateCard('item:x', true, new Date('2026-11-05T12:00:00'), src)
    await saveSettings({ dailyGoal: 33, newPerDay: 5, slots: ['spirit'] }, src)
    const json = JSON.stringify(await createBackup(src))

    const dst = new DeckDB(`b-${Math.random()}`)
    await rateCard('item:other', true, new Date(), dst)
    await restoreBackup(parseBackup(json), dst)

    const reviews = await dst.reviews.toArray()
    expect(reviews.map(r => r.id)).toEqual(['item:x'])
    expect(reviews[0].due).toBeInstanceOf(Date)
    expect((await getSettings(dst)).dailyGoal).toBe(33)
  })

  it('lehnt fremde Dateien ab', () => {
    expect(() => parseBackup('{"foo":1}')).toThrow(/keine DeadlockDeck/)
    expect(() => parseBackup('nope')).toThrow(/kein gültiges JSON/)
  })
})
