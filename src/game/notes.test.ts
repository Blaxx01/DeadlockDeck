import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createBackup, parseBackup, restoreBackup } from '../data/backup'
import { DeckDB } from '../data/db'
import { getNote, NOTE_MAX_LENGTH, saveNote } from './notes'

describe('Merkhilfen', () => {
  it('speichert gekürzt und ohne Leerraum am Rand; leer löscht', async () => {
    const database = new DeckDB(`n-${Math.random()}`)
    expect(await saveNote('item:x', '  rote Patronen = Headhunter\r\n  ', 1, database)).toBe('rote Patronen = Headhunter')
    expect(await getNote('item:x', database)).toEqual({ id: 'item:x', text: 'rote Patronen = Headhunter', updatedAt: 1 })
    expect((await saveNote('item:x', 'a'.repeat(NOTE_MAX_LENGTH + 50), 2, database)).length).toBe(NOTE_MAX_LENGTH)
    expect(await saveNote('item:x', '   ', 3, database)).toBe('')
    expect(await getNote('item:x', database)).toBeUndefined()
  })

  it('sind im Backup; alte Backups ohne Merkhilfen lassen die vorhandenen stehen', async () => {
    const src = new DeckDB(`n-${Math.random()}`)
    await saveNote('hero:hero_haze', 'Hut + Dolch', 1, src)
    const json = JSON.stringify(await createBackup(src))
    const dst = new DeckDB(`n-${Math.random()}`)
    await saveNote('item:old', 'weg damit', 1, dst)
    await restoreBackup(parseBackup(json), dst)
    expect((await dst.notes.toArray()).map(n => [n.id, n.text])).toEqual([['hero:hero_haze', 'Hut + Dolch']])

    const old = JSON.stringify({ app: 'deadlockdeck', version: 1, exportedAt: new Date().toISOString(), settings: { dailyGoal: 20, newPerDay: 3, slots: ['weapon'] }, reviews: [], days: [] })
    await restoreBackup(parseBackup(old), dst)
    expect((await dst.notes.toArray()).map(n => n.id)).toEqual(['hero:hero_haze'])
  })
})
