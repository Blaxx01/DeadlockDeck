/**
 * Souls-Konto: jede Lern-Aktion bringt Souls, die Summe bestimmt den Rang (ranks.ts).
 * Gespeichert als Verlauf (Datum, Menge, Grund) – für Statistik, Rundenregel und Tagesmissionen.
 */
import { addDays, daysBetween, localDate } from '../data/dates'
import { db, getMeta, setMeta, type DeckDB } from '../data/db'

export type SoulsReason =
  | 'card' | 'goal' | 'quiz' | 'guess' | 'build' | 'sprint' | 'survival' | 'map' | 'mission' | 'missions' | 'decay' | 'history'
  /** Karte erstmals Silber/Gold (milestones.ts) */
  | 'milestone'
  /** Neuer Hero-Stern (milestones.ts) */
  | 'star'

/**
 * Zählen nicht als Lerntag (Rang-Verfall): Verfall und Meilensteine. Meilensteine kommen sonst immer mit
 * einer Aktivität – nur das nachträgliche Gutschreiben beim Start wäre sonst ein Lerntag ohne Lernen.
 */
const NOT_ACTIVITY: ReadonlySet<SoulsReason> = new Set<SoulsReason>(['decay', 'milestone', 'star'])

/** Spielmodi mit Runden (je Modus und Tag: die ersten 3 Runden voll, danach ¼) */
export type RoundMode = 'quiz' | 'guess' | 'build' | 'sprint' | 'survival' | 'map'

export interface SoulsEntry {
  id: number
  /** Zeitpunkt (ms) */
  at: number
  /** Lokales Datum YYYY-MM-DD */
  date: string
  /** Souls, negativ beim Verfall */
  amount: number
  reason: SoulsReason
  /** z. B. Quiz-Ergebnis, Missions-ID, Anzahl Karten */
  data?: Record<string, string | number | boolean>
}

export type NewSoulsEntry = Omit<SoulsEntry, 'id'>

/** Karteikarte bewertet – gewusst oder nicht, je Karte einmal pro Tag */
export const CARD_SOULS = 10
export const GOAL_SOULS = 100
export const FULL_ROUNDS_PER_DAY = 3
export const DECAY_SOULS = 50
/** Verfall ab dem 6. Tag ohne Lernen */
export const DECAY_GRACE_DAYS = 5

export function roundSouls(base: number, roundsBefore: number): number {
  const amount = Math.max(0, Math.round(base))
  return roundsBefore >= FULL_ROUNDS_PER_DAY ? Math.round(amount / 4) : amount
}

export interface SoulsGain {
  amount: number
  reason: SoulsReason
  before: number
  after: number
  /** Kurzer Text vor „+N ◆“, z. B. „🥈 Silber“ oder „★ Haze“ */
  label?: string
}

/** Für Animationen: „+10 ◆“ und Aufstieg */
export const soulsEvents = new EventTarget()

function emitGain(gain: SoulsGain): void {
  if (gain.amount !== 0) soulsEvents.dispatchEvent(new CustomEvent<SoulsGain>('souls', { detail: gain }))
}

export async function getSoulsTotal(database: DeckDB = db): Promise<number> {
  return getMeta<number>('soulsTotal', 0, database)
}

/** Neuer Eintrag – nur innerhalb einer Transaktion über souls + meta aufrufen */
export async function addSoulsInTx(database: DeckDB, entry: NewSoulsEntry): Promise<SoulsGain> {
  const before = await getSoulsTotal(database)
  // Verfall nie unter 0
  const amount = entry.amount < 0 ? -Math.min(-entry.amount, before) : entry.amount
  await database.souls.add({ ...entry, amount })
  await setMeta('soulsTotal', before + amount, database)
  return { amount, reason: entry.reason, before, after: before + amount }
}

export async function awardSouls(entry: NewSoulsEntry, database: DeckDB = db): Promise<SoulsGain> {
  // async-Funktion als Rahmen: nur dann hält Dexie die Transaktion über native awaits hinweg
  const gain = await database.transaction('rw', database.souls, database.meta, async () => addSoulsInTx(database, entry))
  emitGain(gain)
  return gain
}

/** Karten-Souls des Tages in einem Eintrag sammeln (sonst Dutzende Einträge pro Tag) – in Transaktion */
export async function addCardSoulsInTx(database: DeckDB, now: Date): Promise<SoulsGain> {
  const date = localDate(now)
  const existing = await database.souls.where('date').equals(date).filter(e => e.reason === 'card').first()
  const before = await getSoulsTotal(database)
  if (existing) {
    const count = Number(existing.data?.count ?? 0) + 1
    await database.souls.update(existing.id, { amount: existing.amount + CARD_SOULS, at: now.getTime(), data: { count } })
  } else {
    await database.souls.add({ at: now.getTime(), date, amount: CARD_SOULS, reason: 'card', data: { count: 1 } })
  }
  await setMeta('soulsTotal', before + CARD_SOULS, database)
  return { amount: CARD_SOULS, reason: 'card', before, after: before + CARD_SOULS }
}

/** Für rateCard: nach der Transaktion die Animation auslösen */
export function announceGain(gain: SoulsGain): void {
  emitGain(gain)
}

export interface RoundAward {
  amount: number
  /** ab der 4. Runde des Tages nur ¼ */
  reduced: boolean
}

/** Souls für eine Runde (Quiz, Hero erraten, Build-Quiz); `data` landet im Verlauf (für Missionen) */
export async function awardRound(
  mode: RoundMode,
  base: number,
  data: Record<string, string | number | boolean>,
  now = new Date(),
  database: DeckDB = db,
): Promise<RoundAward> {
  const date = localDate(now)
  const result = await database.transaction('rw', database.souls, database.meta, async () => {
    const roundsBefore = await database.souls.where('date').equals(date).filter(e => e.reason === mode).count()
    const amount = roundSouls(base, roundsBefore)
    const gain = await addSoulsInTx(database, { at: now.getTime(), date, amount, reason: mode, data: { ...data, base: Math.round(base) } })
    return { gain, reduced: roundsBefore >= FULL_ROUNDS_PER_DAY }
  })
  emitGain(result.gain)
  return { amount: result.gain.amount, reduced: result.reduced }
}

/**
 * Letzter Tag mit einer Aktivität, die Souls bringt (Verfall zählt nicht). Der Start der Souls-Funktion
 * zählt mit – eine Pause von vor dem Update führt nicht sofort zu Verfall.
 */
export async function lastActiveDate(database: DeckDB = db): Promise<string | undefined> {
  const last = (await database.souls.orderBy('date').reverse().filter(e => !NOT_ACTIVITY.has(e.reason)).first())?.date
  const start = await getMeta<string | undefined>('soulsStart', undefined, database)
  if (!last) return undefined
  return start && start > last ? start : last
}

/** Tage mit Verfall: ab dem 6. Tag ohne Lernen, nur vollständig vergangene Tage */
export function decayDates(lastActive: string, today: string): string[] {
  const dates: string[] = []
  for (let d = addDays(lastActive, DECAY_GRACE_DAYS + 1); d < today; d = addDays(d, 1)) dates.push(d)
  return dates
}

/** Tage ohne Lernen bis heute (heute mitgezählt, wenn noch nichts gelernt wurde) – für die Warnung */
export function daysWithoutLearning(lastActive: string | undefined, today: string): number {
  return lastActive ? daysBetween(lastActive, today) : 0
}

/** Bucht fehlenden Verfall (−50 je Tag ab Tag 6 ohne Lernen). Gibt die abgezogenen Souls zurück. */
export async function applyDecay(now = new Date(), database: DeckDB = db): Promise<number> {
  return database.transaction('rw', database.souls, database.meta, async () => {
    const last = await lastActiveDate(database)
    if (!last) return 0
    const booked = new Set((await database.souls.where('date').above(last).filter(e => e.reason === 'decay').toArray()).map(e => e.date))
    let lost = 0
    for (const date of decayDates(last, localDate(now))) {
      if (booked.has(date)) continue
      const gain = await addSoulsInTx(database, { at: now.getTime(), date, amount: -DECAY_SOULS, reason: 'decay' })
      lost -= gain.amount
    }
    return lost
  })
}

/**
 * Einmalig beim ersten Start mit Souls: bisheriges Lernen nachträglich gutschreiben
 * (+10 je Karte und Tag, +100 je erreichtem Tagesziel) – damit der Rang die bisherige Arbeit zeigt.
 */
export async function seedSoulsFromHistory(goal: number, database: DeckDB = db): Promise<number> {
  return database.transaction('rw', database.souls, database.meta, database.days, async () => {
    if (await getMeta<boolean>('soulsSeeded', false, database)) return 0
    await setMeta('soulsSeeded', true, database)
    await setMeta('soulsStart', localDate(), database)
    if ((await database.souls.count()) > 0) return 0
    let total = 0
    for (const day of await database.days.toArray()) {
      const amount = day.reviewed * CARD_SOULS + (day.reviewed >= goal ? GOAL_SOULS : 0)
      if (amount <= 0) continue
      const gain = await addSoulsInTx(database, { at: Date.now(), date: day.date, amount, reason: 'history', data: { cards: day.reviewed } })
      total += gain.amount
    }
    return total
  })
}
