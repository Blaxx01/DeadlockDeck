import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { DeckDB, setMeta } from './db'
import { MAP_DATA_VERSION, mapNeedsSync } from './mapSync'

describe('Map neu laden', () => {
  it('wenn sie fehlt oder mit einer älteren Aufbereitung gespeichert ist', async () => {
    const database = new DeckDB(`ms-${Math.random()}`)
    expect(await mapNeedsSync(database)).toBe(true)
    await setMeta('mapData', { image: 'm.png', points: [], ziplines: [] }, database)
    // gespeichert vor der Versionsnummer (erste Fassung, Ziele noch verschoben)
    expect(await mapNeedsSync(database)).toBe(true)
    await setMeta('mapDataVersion', MAP_DATA_VERSION, database)
    expect(await mapNeedsSync(database)).toBe(false)
  })
})
