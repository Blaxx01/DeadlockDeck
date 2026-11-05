import { db, getMeta, getSettings, saveSettings, setMeta, type DayRecord, type DeckDB, type ReviewRecord, type Settings } from './db'

export interface BackupFile {
  app: 'deadlockdeck'
  version: 1
  exportedAt: string
  settings: Settings
  reviews: ReviewRecord[]
  days: DayRecord[]
  quizHighscore?: number
}

export async function createBackup(database: DeckDB = db): Promise<BackupFile> {
  return {
    app: 'deadlockdeck',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: await getSettings(database),
    reviews: await database.reviews.toArray(),
    days: await database.days.toArray(),
    quizHighscore: await getMeta<number>('quizHighscore', 0, database),
  }
}

function reviveDate(value: unknown): Date | undefined {
  if (value === undefined || value === null) return undefined
  const d = new Date(value as string)
  if (Number.isNaN(d.getTime())) throw new Error('Ungültiges Datum in der Backup-Datei.')
  return d
}

export function parseBackup(json: string): BackupFile {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error('Die Datei ist kein gültiges JSON.')
  }
  const b = data as Partial<BackupFile>
  if (b?.app !== 'deadlockdeck' || b.version !== 1 || !Array.isArray(b.reviews) || !Array.isArray(b.days)) {
    throw new Error('Das ist keine DeadlockDeck-Backup-Datei.')
  }
  return {
    ...(b as BackupFile),
    reviews: b.reviews.map(r => ({
      ...r,
      due: reviveDate(r.due)!,
      last_review: reviveDate(r.last_review),
    })),
  }
}

/** Ersetzt Fortschritt und Einstellungen durch den Inhalt des Backups. */
export async function restoreBackup(backup: BackupFile, database: DeckDB = db): Promise<void> {
  await database.transaction('rw', database.reviews, database.days, database.meta, async () => {
    await database.reviews.clear()
    await database.days.clear()
    await database.reviews.bulkPut(backup.reviews)
    await database.days.bulkPut(backup.days)
    if (backup.settings) await saveSettings(backup.settings, database)
    if (typeof backup.quizHighscore === 'number') await setMeta('quizHighscore', backup.quizHighscore, database)
  })
}

export function downloadBackup(backup: BackupFile): void {
  const blob = new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `deadlockdeck-backup-${backup.exportedAt.slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
