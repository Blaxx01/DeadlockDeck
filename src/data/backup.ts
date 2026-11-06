import { checkAllMilestones, getMilestones, resetMilestonesInTx, type MilestoneMap, type StarMap } from '../game/milestones'
import { seedSoulsFromHistory, type SoulsEntry } from '../game/souls'
import type { MistakeEntry } from '../game/weakness'
import type { SprintHighscores } from '../sprint/sprint'
import { addDays, daysBetween, localDate } from './dates'
import {
  db, getBuildBests, getMeta, getSettings, getSprintHighscores, saveSettings, setMeta,
  type BuildBest, type DayRecord, type DeckDB, type NoteRecord, type ReviewRecord, type Settings,
} from './db'

export interface BackupFile {
  app: 'deadlockdeck'
  version: 1
  exportedAt: string
  settings: Settings
  reviews: ReviewRecord[]
  days: DayRecord[]
  quizHighscore?: number
  guessHighscore?: number
  /** 60-Sekunden-Sprint: Highscore je Auswahl */
  sprintHighscore?: SprintHighscores
  survivalHighscore?: number
  mapHighscore?: number
  /** Build-Quiz-Bestwerte je Hero und Build-Art */
  buildBest?: Record<string, BuildBest>
  /** Souls-Verlauf (Rang) */
  souls?: SoulsEntry[]
  /** Start der Souls-Funktion (für den Rang-Verfall) */
  soulsStart?: string
  /** Fehler der letzten 14 Tage (Schwächen-Training) */
  mistakes?: MistakeEntry[]
  /** Schon belohnte Meilensteine: Karte → Silber/Gold */
  milestones?: MilestoneMap
  /** Schon belohnte Hero-Sterne */
  heroStars?: StarMap
  /** Heroes, die einmal ohne Aufdecken, Joker und Fehltipp erraten wurden */
  guessClean?: string[]
  /** Eigene Merkhilfen */
  notes?: NoteRecord[]
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
    sprintHighscore: await getSprintHighscores(database),
    survivalHighscore: await getMeta<number>('survivalHighscore', 0, database),
    mapHighscore: await getMeta<number>('mapHighscore', 0, database),
    buildBest: await getBuildBests(database),
    souls: await database.souls.toArray(),
    soulsStart: await getMeta<string | undefined>('soulsStart', undefined, database),
    mistakes: await database.mistakes.toArray(),
    ...(await getMilestones(database)),
    notes: await database.notes.toArray(),
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
  await database.transaction('rw', [database.reviews, database.days, database.meta, database.souls, database.mistakes, database.notes], async () => {
    // Merkhilfen: aus dem Backup; alte Backups ohne Merkhilfen lassen die vorhandenen stehen
    if (Array.isArray(backup.notes)) {
      await database.notes.clear()
      await database.notes.bulkPut(backup.notes.filter(n => typeof n?.id === 'string' && typeof n.text === 'string'))
    }
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
    if (isRecord(backup.sprintHighscore)) await setMeta('sprintHighscore', backup.sprintHighscore, database)
    if (typeof backup.survivalHighscore === 'number') await setMeta('survivalHighscore', backup.survivalHighscore, database)
    if (typeof backup.mapHighscore === 'number') await setMeta('mapHighscore', backup.mapHighscore, database)
    if (backup.buildBest && typeof backup.buildBest === 'object') await setMeta('buildBest', backup.buildBest, database)
    // Meilensteine gehören zum Souls-Verlauf des Backups (alte Backups: keine – werden unten neu berechnet)
    await resetMilestonesInTx(database, {
      milestones: isRecord(backup.milestones) ? backup.milestones : undefined,
      heroStars: isRecord(backup.heroStars) ? backup.heroStars : undefined,
      guessClean: Array.isArray(backup.guessClean) ? backup.guessClean : undefined,
    })
  })
  if (!Array.isArray(backup.souls) || backup.souls.length === 0) {
    await seedSoulsFromHistory((await getSettings(database)).dailyGoal, database)
  }
  // Meilensteine, die der Fortschritt hergibt, aber noch nicht belohnt sind (z. B. Backup von vor den Meilensteinen)
  await checkAllMilestones(new Date(), database)
  // Der Stand entspricht jetzt diesem Backup
  const exported = Date.parse(backup.exportedAt)
  if (Number.isFinite(exported)) await markBackupDone(new Date(exported), database)
}

function isRecord<T>(value: T | undefined): value is T {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function downloadFile(text: string, name: string): void {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Auf dem Handy (Touch) übers Teilen-Menü sichern – Dateien, Drive, Mail … */
export function prefersShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && typeof navigator.share === 'function'
    && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
}

export type BackupResult = 'shared' | 'downloaded' | 'cancelled'

/**
 * Backup erstellen und sichern: auf dem Handy übers Teilen-Menü, sonst (oder mit `download`) als Datei.
 * Gelungen → als letztes Backup gemerkt. Abgebrochenes Teilen ändert nichts.
 */
export async function exportBackup({ download = false, now = new Date(), database = db }: { download?: boolean; now?: Date; database?: DeckDB } = {}): Promise<BackupResult> {
  const json = JSON.stringify(await createBackup(database), null, 1)
  const name = `deadlockdeck-backup-${localDate(now)}`
  if (!download && prefersShare()) {
    // Chrome teilt keine JSON-Dateien – dann als Textdatei (der Import liest beides)
    const files = [new File([json], `${name}.json`, { type: 'application/json' }), new File([json], `${name}.txt`, { type: 'text/plain' })]
    const file = files.find(f => navigator.canShare({ files: [f] }))
    if (file) {
      try {
        await navigator.share({ files: [file], title: 'DeadlockDeck-Backup' })
        await markBackupDone(now, database)
        return 'shared'
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
        // z. B. Teilen nicht erlaubt – dann herunterladen
      }
    }
  }
  downloadFile(json, `${name}.json`)
  await markBackupDone(now, database)
  return 'downloaded'
}

/** Nie gesichert: Erinnerung so viele Tage nach dem ersten Lerntag */
export const BACKUP_FIRST_DAYS = 7
/** Danach: so viele Tage nach dem letzten Backup (wenn seitdem gelernt wurde) */
export const BACKUP_EVERY_DAYS = 14
/** „Später“ blendet die Erinnerung so lange aus */
export const BACKUP_SNOOZE_DAYS = 3

export interface BackupStatus {
  /** Letztes Backup (ms) */
  lastBackupAt?: number
  /** Ganze Tage seit dem letzten Backup */
  daysSince?: number
  /** Erinnerung auf der Startseite zeigen */
  remind: boolean
}

export interface BackupReminderInput {
  lastBackupAt?: number
  /** Ausgeblendet bis (lokales Datum, ausschließlich) */
  snoozedUntil?: string
  /** Erster und letzter Tag mit Lernen */
  firstDay?: string
  lastDay?: string
}

/** Erinnerung fällig? Nur mit Fortschritt; nach einem Backup nur, wenn seitdem gelernt wurde */
export function backupReminderDue({ lastBackupAt, snoozedUntil, firstDay, lastDay }: BackupReminderInput, now: Date): boolean {
  if (!firstDay || !lastDay) return false
  const today = localDate(now)
  if (snoozedUntil && today < snoozedUntil) return false
  if (lastBackupAt === undefined) return daysBetween(firstDay, today) >= BACKUP_FIRST_DAYS
  const backupDay = localDate(new Date(lastBackupAt))
  return lastDay >= backupDay && daysBetween(backupDay, today) >= BACKUP_EVERY_DAYS
}

export async function getBackupStatus(now = new Date(), database: DeckDB = db): Promise<BackupStatus> {
  const [lastBackupAt, snoozedUntil, days] = await Promise.all([
    getMeta<number | null>('lastBackupAt', null, database),
    getMeta<string | null>('backupSnoozedUntil', null, database),
    database.days.toArray(),
  ])
  const learned = days.filter(d => d.reviewed > 0).map(d => d.date).sort()
  const last = lastBackupAt ?? undefined
  return {
    lastBackupAt: last,
    daysSince: last === undefined ? undefined : daysBetween(localDate(new Date(last)), localDate(now)),
    remind: backupReminderDue({ lastBackupAt: last, snoozedUntil: snoozedUntil ?? undefined, firstDay: learned[0], lastDay: learned.at(-1) }, now),
  }
}

/** „heute“, „gestern“, „vor 5 Tagen“ */
export function daysAgoText(days: number): string {
  if (days <= 0) return 'heute'
  if (days === 1) return 'gestern'
  return `vor ${days} Tagen`
}

/** Backup gesichert: Erinnerung zurücksetzen */
export async function markBackupDone(now = new Date(), database: DeckDB = db): Promise<void> {
  await setMeta('lastBackupAt', now.getTime(), database)
  await setMeta('backupSnoozedUntil', null, database)
}

/** „Später“: Erinnerung ein paar Tage ausblenden */
export async function snoozeBackupReminder(now = new Date(), database: DeckDB = db): Promise<void> {
  await setMeta('backupSnoozedUntil', addDays(localDate(now), BACKUP_SNOOZE_DAYS), database)
}
