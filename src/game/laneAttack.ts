/**
 * Lane-Angriff: Die Tagesmissionen greifen jeden Tag auf einer Lane an – Guardian → Walker → Patron.
 * Jede geschaffte Mission zerstört das vorderste Ziel (in der Reihenfolge, in der sie geschafft werden),
 * bis dahin macht die am weitesten fortgeschrittene offene Mission Schaden.
 * Siege und Niederlagen ergeben sich aus dem Souls-Verlauf (Bonus für alle drei Missionen = Sieg).
 */
import { localDate } from '../data/dates'
import { db, getMeta, setMeta, type DeckDB } from '../data/db'
import type { Lane, MapData, MapPoint } from '../map/mapData'
import { hashString, seededRng } from './random'
import type { SoulsEntry, SoulsReason } from './souls'

export type Patron = 'hiddenKing' | 'archmother'

export const PATRONS: Patron[] = ['hiddenKing', 'archmother']

export const PATRON_LABEL: Record<Patron, string> = { hiddenKing: 'Hidden King', archmother: 'Archmother' }

/** Lanes der Map (links → rechts) */
export const ATTACK_LANES: Lane[] = ['yellow', 'blue', 'green']

export const LANE_NAME: Record<Lane, string> = { yellow: 'Gelbe Lane', blue: 'Blaue Lane', green: 'Grüne Lane', purple: 'Lila Lane' }

export type LaneTargetKind = 'guardian' | 'walker' | 'patron'

export const LANE_TARGETS: LaneTargetKind[] = ['guardian', 'walker', 'patron']

export interface LaneDayInfo {
  lane: Lane
  patron: Patron
}

/** Lane und Gegner des Tages – fest pro Datum, auf jedem Gerät gleich */
export function laneForDay(date: string): LaneDayInfo {
  const rng = seededRng(hashString(`lane:${date}`))
  const lane = ATTACK_LANES[Math.floor(rng() * ATTACK_LANES.length)]
  const patron = PATRONS[Math.floor(rng() * PATRONS.length)]
  return { lane, patron }
}

export function targetLabel(kind: LaneTargetKind, patron: Patron): string {
  return kind === 'patron' ? PATRON_LABEL[patron] : kind === 'guardian' ? 'Guardian' : 'Walker'
}

/** Was der Lane-Angriff von einer Mission braucht (passt zu MissionStatus) */
export interface LaneMission {
  def: { id: string; title: string; target: number }
  progress: number
  done: boolean
  /** Reihenfolge des Schaffens (ID des Souls-Eintrags der Belohnung); fehlt = gerade erst geschafft */
  doneSeq?: number
}

export interface LaneTarget {
  kind: LaneTargetKind
  /** Leben 0–1 */
  hp: number
  /** Titel der Mission, die es zerstört hat */
  by?: string
}

export interface LaneState extends LaneDayInfo {
  date: string
  targets: LaneTarget[]
  /** Index des vordersten Ziels (3 = alle zerstört) */
  front: number
  won: boolean
}

/** Stand des Tages – nur mit genau drei Missionen (sonst kein Lane-Angriff) */
export function laneState(date: string, missions: readonly LaneMission[]): LaneState | null {
  if (missions.length !== LANE_TARGETS.length) return null
  const done = missions
    .map((m, i) => ({ m, i }))
    .filter(x => x.m.done)
    .sort((a, b) => (a.m.doneSeq ?? Infinity) - (b.m.doneSeq ?? Infinity) || a.i - b.i)
    .map(x => x.m)
  const best = Math.max(0, ...missions.filter(m => !m.done).map(m => (m.def.target > 0 ? Math.min(1, m.progress / m.def.target) : 0)))
  const targets = LANE_TARGETS.map((kind, i): LaneTarget =>
    i < done.length ? { kind, hp: 0, by: done[i].def.title } : { kind, hp: i === done.length ? 1 - best : 1 })
  return { date, ...laneForDay(date), targets, front: done.length, won: done.length >= LANE_TARGETS.length }
}

/** Leben in Prozent – aufgerundet, damit „0 %“ nur bei zerstörten Zielen steht */
export function hpPercent(hp: number): number {
  if (hp <= 0) return 0
  return Math.min(100, Math.ceil(Math.round(hp * 1e6) / 1e4))
}

// ---------- Effekte ----------

export interface LaneChange {
  state: LaneState
  /** Schaden am (jetzt) vordersten Ziel: Leben vorher/nachher in Prozent */
  damage?: { kind: LaneTargetKind; before: number; after: number }
  /** Gerade zerstörte Ziele, in Reihenfolge */
  destroyed: LaneTargetKind[]
  /** Gerade gewonnen (Patron gefallen) */
  won: boolean
}

/** Was sich seit dem letzten Stand getan hat (gleicher Tag), sonst null */
export function laneChange(prev: LaneState | null | undefined, next: LaneState | null): LaneChange | null {
  if (!prev || !next || prev.date !== next.date) return null
  const destroyed = next.targets.filter((t, i) => t.hp <= 0 && prev.targets[i].hp > 0).map(t => t.kind)
  const won = next.won && !prev.won
  const front = next.targets[next.front] as LaneTarget | undefined
  const before = front ? hpPercent(prev.targets[next.front].hp) : 0
  const after = front ? hpPercent(front.hp) : 0
  const damage = front && after < before ? { kind: front.kind, before, after } : undefined
  if (!destroyed.length && !damage && !won) return null
  return { state: next, damage, destroyed, won }
}

/** Für Einblendungen in Sessions und Spielen */
export const laneEvents = new EventTarget()

let lastState: LaneState | null = null

/** Neuen Stand melden (nach jeder Missions-Prüfung): Änderungen zum letzten Stand lösen ein Ereignis aus */
export function trackLane(next: LaneState | null): LaneChange | null {
  const change = laneChange(lastState, next)
  lastState = next
  if (change) laneEvents.dispatchEvent(new CustomEvent<LaneChange>('lane', { detail: change }))
  return change
}

/** Zuletzt auf der Startseite gezeigter Stand (für die Animation dorthin) */
export interface LaneShown {
  date: string
  hp: number[]
  won: boolean
}

export function shownOf(state: LaneState): LaneShown {
  return { date: state.date, hp: state.targets.map(t => t.hp), won: state.won }
}

/**
 * Ab welchem Stand die Startseite die Leiste animiert: zuletzt gezeigter Stand desselben Tages, sonst volle Leben.
 * null = nichts zu animieren (gleich – oder der Stand ist zurückgegangen, z. B. nach „Fortschritt löschen“).
 */
export function laneAnimationStart(shown: LaneShown | null | undefined, state: LaneState): LaneShown | null {
  const from = shown?.date === state.date && shown.hp.length === state.targets.length
    ? shown
    : { date: state.date, hp: state.targets.map(() => 1), won: false }
  const behind = from.hp.some((hp, i) => hpPercent(hp) < hpPercent(state.targets[i].hp))
  return isShown(from, state) || behind ? null : from
}

/** Zeigt die Startseite schon genau diesen Stand? */
export function isShown(shown: LaneShown | null | undefined, state: LaneState): boolean {
  return !!shown && shown.date === state.date && shown.won === state.won && shown.hp.length === state.targets.length
    && shown.hp.every((hp, i) => hpPercent(hp) === hpPercent(state.targets[i].hp))
}

export async function markLaneShown(state: LaneState, database: DeckDB = db): Promise<void> {
  await setMeta('laneShown', shownOf(state), database)
}

// ---------- Bilanz ----------

/** Kein Lernen oder Spielen: Verfall, Nachträge, Meilensteine */
const NOT_PLAYED: ReadonlySet<SoulsReason> = new Set<SoulsReason>(['decay', 'history', 'milestone', 'star'])

export interface LaneDay extends LaneDayInfo {
  date: string
  won: boolean
}

/**
 * Gezählte Tage ab dem ersten Tag mit Lane-Angriff: Sieg = Bonus für alle drei Missionen; Niederlage = gelernt oder
 * gespielt, ohne zu gewinnen – heute erst, wenn der Tag vorbei ist. Tage ohne Lernen und Spielen zählen nicht.
 */
export function laneDays(entries: readonly Pick<SoulsEntry, 'date' | 'reason'>[], start: string | null | undefined, today: string): LaneDay[] {
  if (!start) return []
  const won = new Set<string>()
  const played = new Set<string>()
  for (const e of entries) {
    if (e.date < start || e.date > today) continue
    if (e.reason === 'missions') won.add(e.date)
    else if (!NOT_PLAYED.has(e.reason) && e.date < today) played.add(e.date)
  }
  return [...new Set([...won, ...played])].sort().map(date => ({ date, ...laneForDay(date), won: won.has(date) }))
}

export interface LaneRecord {
  wins: number
  losses: number
}

export interface LaneSummary extends LaneRecord {
  /** Siege in Folge bis jetzt (ein laufender Tag und Tage ohne Lernen unterbrechen nicht) */
  streak: number
  /** Längste Siegesserie */
  best: number
  byPatron: Record<Patron, LaneRecord>
}

export function summarizeLanes(days: readonly LaneDay[]): LaneSummary {
  const byPatron: Record<Patron, LaneRecord> = { hiddenKing: { wins: 0, losses: 0 }, archmother: { wins: 0, losses: 0 } }
  let streak = 0
  let best = 0
  for (const day of days) {
    if (day.won) {
      streak++
      best = Math.max(best, streak)
      byPatron[day.patron].wins++
    } else {
      streak = 0
      byPatron[day.patron].losses++
    }
  }
  const wins = byPatron.hiddenKing.wins + byPatron.archmother.wins
  const losses = byPatron.hiddenKing.losses + byPatron.archmother.losses
  return { wins, losses, streak, best, byPatron }
}

export async function getLaneSummary(now = new Date(), database: DeckDB = db): Promise<LaneSummary> {
  const [entries, start] = await Promise.all([database.souls.toArray(), getMeta<string | null>('laneStart', null, database)])
  return summarizeLanes(laneDays(entries, start, localDate(now)))
}

// ---------- Map ----------

/** Die Ziele der Lane in der oberen Basis (angegriffen wird immer nach oben) */
export function laneTargetPoints(data: MapData, lane: Lane): Partial<Record<LaneTargetKind, MapPoint>> {
  const top = (kind: LaneTargetKind) => data.points
    .filter(p => p.kind === kind && p.y < 0.5 && (kind === 'patron' || p.lane === lane))
    .sort((a, b) => a.y - b.y)[0]
  const out: Partial<Record<LaneTargetKind, MapPoint>> = {}
  for (const kind of LANE_TARGETS) {
    const point = top(kind)
    if (point) out[kind] = point
  }
  return out
}
