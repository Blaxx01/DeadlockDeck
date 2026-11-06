import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { rateCard } from '../srs/srs'
import {
  BACKUP_EVERY_DAYS, BACKUP_FIRST_DAYS, BACKUP_SNOOZE_DAYS, backupReminderDue, daysAgoText, exportBackup, getBackupStatus,
  markBackupDone, parseBackup, restoreBackup, snoozeBackupReminder,
} from './backup'
import { DeckDB, getMeta } from './db'
import { ensurePersistentStorage, isStoragePersisted, type StorageApi } from './persist'

const at = (d: number, h = 12) => new Date(2026, 10, d, h)

describe('Backup-Erinnerung (Regeln)', () => {
  it('ohne Fortschritt nie; nie gesichert: eine Woche nach dem ersten Lerntag', () => {
    expect(backupReminderDue({}, at(20))).toBe(false)
    const first = { firstDay: '2026-11-01', lastDay: '2026-11-03' }
    expect(backupReminderDue(first, at(1 + BACKUP_FIRST_DAYS - 1))).toBe(false)
    expect(backupReminderDue(first, at(1 + BACKUP_FIRST_DAYS))).toBe(true)
  })

  it('nach einem Backup: zwei Wochen später, aber nur wenn seitdem gelernt wurde', () => {
    const backup = at(1, 20).getTime()
    expect(backupReminderDue({ lastBackupAt: backup, firstDay: '2026-10-01', lastDay: '2026-11-10' }, at(1 + BACKUP_EVERY_DAYS - 1))).toBe(false)
    expect(backupReminderDue({ lastBackupAt: backup, firstDay: '2026-10-01', lastDay: '2026-11-10' }, at(1 + BACKUP_EVERY_DAYS))).toBe(true)
    // am Tag des Backups gelernt zählt (Reihenfolge unbekannt), davor nicht
    expect(backupReminderDue({ lastBackupAt: backup, firstDay: '2026-10-01', lastDay: '2026-11-01' }, at(20))).toBe(true)
    expect(backupReminderDue({ lastBackupAt: backup, firstDay: '2026-10-01', lastDay: '2026-10-31' }, at(20))).toBe(false)
  })

  it('„Später“ blendet die Erinnerung ein paar Tage aus', () => {
    const input = { firstDay: '2026-10-01', lastDay: '2026-11-05', snoozedUntil: '2026-11-09' }
    expect(backupReminderDue(input, at(8))).toBe(false)
    expect(backupReminderDue(input, at(9))).toBe(true)
  })

  it('Text: heute, gestern, vor n Tagen', () => {
    expect([0, 1, 5].map(daysAgoText)).toEqual(['heute', 'gestern', 'vor 5 Tagen'])
  })
})

describe('Backup-Erinnerung (gespeichert)', () => {
  it('erscheint nach einer Woche, „Später“ für 3 Tage, ein Backup setzt sie zurück', async () => {
    const database = new DeckDB(`br-${Math.random()}`)
    expect(await getBackupStatus(at(1), database)).toEqual({ lastBackupAt: undefined, daysSince: undefined, remind: false })
    await rateCard('item:x', true, at(1), database)
    expect((await getBackupStatus(at(7), database)).remind).toBe(false)
    expect((await getBackupStatus(at(8), database)).remind).toBe(true)

    await snoozeBackupReminder(at(8), database)
    expect((await getBackupStatus(at(8 + BACKUP_SNOOZE_DAYS - 1), database)).remind).toBe(false)
    expect((await getBackupStatus(at(8 + BACKUP_SNOOZE_DAYS), database)).remind).toBe(true)

    await markBackupDone(at(12), database)
    expect(await getBackupStatus(at(15), database)).toEqual({ lastBackupAt: at(12).getTime(), daysSince: 3, remind: false })
    // ohne Lernen seit dem Backup keine Erinnerung, mit Lernen nach zwei Wochen
    expect((await getBackupStatus(at(12 + BACKUP_EVERY_DAYS), database)).remind).toBe(false)
    await rateCard('item:y', true, at(13), database)
    expect((await getBackupStatus(at(12 + BACKUP_EVERY_DAYS), database)).remind).toBe(true)
  })

  it('Export merkt das Backup (ohne Teilen-Menü als Download); Einspielen setzt den Stand des Backups', async () => {
    const database = new DeckDB(`be-${Math.random()}`)
    await rateCard('item:x', true, at(1), database)
    let saved = ''
    const click = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: (b: Blob) => { void b.text().then(t => { saved = t }); return 'blob:x' }, revokeObjectURL: () => {} })
    vi.stubGlobal('document', { createElement: () => ({ click, remove: () => {} }), body: { appendChild: () => {} } })
    try {
      expect(await exportBackup({ now: at(9), database })).toBe('downloaded')
    } finally {
      vi.unstubAllGlobals()
    }
    expect(click).toHaveBeenCalled()
    expect(await getMeta('lastBackupAt', null, database)).toBe(at(9).getTime())
    await vi.waitFor(() => expect(saved).toContain('"app": "deadlockdeck"'))

    const other = new DeckDB(`be2-${Math.random()}`)
    await restoreBackup(parseBackup(saved), other)
    const exportedAt = Date.parse(parseBackup(saved).exportedAt)
    expect(await getMeta('lastBackupAt', null, other)).toBe(exportedAt)
  })
})

describe('Dauerhafter Speicher', () => {
  function fakeStorage(persisted: boolean, grant: boolean) {
    const api = { persisted: vi.fn(async () => persisted), persist: vi.fn(async () => grant) }
    return api satisfies StorageApi
  }

  it('fragt erst mit Fortschritt, höchstens einmal am Tag', async () => {
    const database = new DeckDB(`ps-${Math.random()}`)
    const storage = fakeStorage(false, true)
    expect(await ensurePersistentStorage(at(1), database, storage)).toBe(false)
    expect(storage.persist).not.toHaveBeenCalled()

    await rateCard('item:x', true, at(1), database)
    expect(await ensurePersistentStorage(at(1), database, storage)).toBe(true)
    expect(await ensurePersistentStorage(at(1, 18), database, storage)).toBe(false)
    expect(storage.persist).toHaveBeenCalledTimes(1)
    expect(await ensurePersistentStorage(at(2), database, storage)).toBe(true)
    expect(storage.persist).toHaveBeenCalledTimes(2)
  })

  it('schon dauerhaft: keine Anfrage; ohne Speicher-API: unbekannt', async () => {
    const database = new DeckDB(`ps-${Math.random()}`)
    const storage = fakeStorage(true, true)
    expect(await ensurePersistentStorage(at(1), database, storage)).toBe(true)
    expect(storage.persist).not.toHaveBeenCalled()
    expect(await isStoragePersisted(storage)).toBe(true)
    expect(await ensurePersistentStorage(at(1), database, undefined)).toBeUndefined()
    expect(await isStoragePersisted(undefined)).toBeUndefined()
  })
})
