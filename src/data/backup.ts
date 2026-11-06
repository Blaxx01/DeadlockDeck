import { seedSoulsFromHistory, type SoulsEntry } from '../game/souls'
import type { MistakeEntry } from '../game/weakness'
import { db, getBuildBests, getMeta, getSettings, saveSettings, setMeta, type BuildBest, type DayRecord, type DeckDB, type ReviewRecord, type Settings } from './db'

export interface BackupFile {
  app: 'deadlockdeck'
  version: 1
  exportedAt: string
  settings: Settings
  reviews: ReviewRecord[]
  days: DayRecord[]
  quizHighscore?: number
  guessHighscore?: number
  /** Build-Quiz-Bestwerte je Hero und Build-Art */
  buildBest?: Record<string, BuildBest>
  /** Souls-Verlauf (Rang) */
  souls?: SoulsEntry[]
  /** Start der Souls-Funktion (für den Rang-Verfall) */
  soulsStart?: string
  /** Fehler der letzten 14 Tage (Schwächen-Training) */
  mistakes?: MistakeEntry[]
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
    guessHighscore: await getMeta<number>('guessHighscore', 0, database),
    buildBest: await getBuildBests(database),
    souls: await database.souls.toArray(),
    soulsStart: await getMeta<string | undefined>('soulsStart', undefined, database),
    mistakes: await database.mistakes.toArray(),
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
  await database.transaction('rw', [database.reviews, database.days, database.meta, database.souls, database.mistakes], async () => {
    await database.reviews.clear()
    await database.days.clear()
    await database.souls.clear()
    await database.mistakes.clear()
    if (Array.isArray(backup.mistakes)) await database.mistakes.bulkAdd(backup.mistakes)
    // Souls: aus dem Backup – bei alten Backups ohne Souls aus der Tageshistorie neu berechnen (unten)
    const souls = Array.isArray(backup.souls) ? backup.souls : []
    await database.souls.bulkAdd(souls)
    await setMeta('soulsTotal', souls.reduce((sum, e) => sum + (Number(e.amount) || 0), 0), database)
    await setMeta('soulsSeeded', souls.length > 0, database)
    if (backup.soulsStart) await setMeta('soulsStart', backup.soulsStart, database)
    await setMeta('missions', null, database)
    await database.reviews.bulkPut(backup.reviews)
    await database.days.bulkPut(backup.days)
    if (backup.settings) await saveSettings(backup.settings, database)
    if (typeof backup.quizHighscore === 'number') await setMeta('quizHighscore', backup.quizHighscore, database)
    if (typeof backup.guessHighscore === 'number') await setMeta('guessHighscore', backup.guessHighscore, database)
    if (backup.buildBest && typeof backup.buildBest === 'object') await setMeta('buildBest', backup.buildBest, database)
  })
  if (!Array.isArray(backup.souls) || backup.souls.length === 0) {
    await seedSoulsFromHistory((await getSettings(database)).dailyGoal, database)
  }
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
