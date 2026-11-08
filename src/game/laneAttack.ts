/**
 * Lane-Angriff: Die Tagesmissionen greifen jeden Tag auf einer Lane an – Guardian → Walker → Patron.
 * Schaden ist der Gesamtfortschritt aller drei Missionen: je eine volle Mission an Fortschritt zerstört ein Ziel,
 * der Patron fällt, wenn alle drei geschafft sind. Dazu Held des Tages, Mid Boss (Rejuvenator), Revanche.
 * Siege, Niederlagen, Revanchen, Rejuvenator, Trophäen und Siege je Held ergeben sich aus dem Souls-Verlauf.
 */
import { localDate } from '../data/dates'
import { db, getMeta, setMeta, type DeckDB } from '../data/db'
import type { Lane, MapData, MapPoint } from '../map/mapData'
import { hashString, seededRng } from './random'
import type { SoulsEntry, SoulsReason } from './souls'

export type Patron = 'hiddenKing' | 'archmother'

export const PATRONS: Patron[] = ['hiddenKing', 'archmother']

function isPatron(value: unknown): value is Patron {
  return PATRONS.includes(value as Patron)
}

function isAttackLane(value: unknown): value is Lane {
  return ATTACK_LANES.includes(value as Lane)
}

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
}

export interface LaneTarget {
  kind: LaneTargetKind
  /** Leben 0–1 */
  hp: number
}

/** Held des Tages (Hero-Karte) */
export interface LaneHero {
  id: string
  name: string
  image?: string
}

/** Mid Boss: freiwilliges Bonusziel des Tages */
export interface LaneBoss {
  title: string
  progress: number
  target: number
  done: boolean
}

/** Was der Stand außer den Missionen braucht (aus dem Verlauf und der Wahl des Tages) */
export interface LaneContext {
  patron: Patron
  /** Lane getauscht: diese statt der Lane des Tages */
  lane?: Lane
  /** Derselbe Patron wie bei der letzten Niederlage */
  revenge: boolean
  /** Rejuvenator auf Vorrat (schützt die Siegesserie einmal) */
  rejuvenator: boolean
  /** Siegesserie bis jetzt (mit heute, wenn schon gewonnen) */
  streak: number
  /** Heute gewonnen und damit eine Trophäe erreicht: Siege gegen diesen Patron */
  trophy?: number
  hero?: LaneHero
  midBoss?: LaneBoss
}

export interface LaneState extends LaneDayInfo, Omit<LaneContext, 'patron' | 'lane'> {
  date: string
  targets: LaneTarget[]
  /** Index des vordersten Ziels (3 = alle zerstört) */
  front: number
  won: boolean
}

/** Gesamtfortschritt der Missionen: je geschaffte Mission 1, sonst der Anteil (0–3) */
export function missionsProgress(missions: readonly LaneMission[]): number {
  return missions.reduce((sum, m) => sum + (m.done ? 1 : m.def.target > 0 ? Math.min(1, m.progress / m.def.target) : 0), 0)
}

/** Stand des Tages – nur mit genau drei Missionen (sonst kein Lane-Angriff) */
export function laneState(date: string, missions: readonly LaneMission[], context?: Partial<LaneContext>): LaneState | null {
  if (missions.length !== LANE_TARGETS.length) return null
  const won = missions.every(m => m.done)
  const total = missionsProgress(missions)
  const targets = LANE_TARGETS.map((kind, i): LaneTarget => ({
    kind,
    // je volle Mission ein Ziel; gerundet gegen Rechenfehler (0,1 + 0,2 …)
    hp: won ? 0 : Math.min(1, Math.max(0, Math.round((1 - (total - i)) * 1e9) / 1e9)),
  }))
  const front = targets.findIndex(t => t.hp > 0)
  const day = laneForDay(date)
  return {
    date, lane: context?.lane ?? day.lane, patron: context?.patron ?? day.patron, targets, front: front < 0 ? LANE_TARGETS.length : front, won,
    revenge: context?.revenge ?? false, rejuvenator: context?.rejuvenator ?? false, streak: context?.streak ?? 0,
    ...(context?.trophy ? { trophy: context.trophy } : {}),
    ...(context?.hero ? { hero: context.hero } : {}),
    ...(context?.midBoss ? { midBoss: context.midBoss } : {}),
  }
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
  /** Gerade gewonnen (Patron gefallen) – Revanche und Trophäe stehen im Stand */
  won: boolean
  /** Mid Boss gerade besiegt (Rejuvenator) */
  midBoss: boolean
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
  const midBoss = !!next.midBoss?.done && !!prev.midBoss && !prev.midBoss.done
  if (!destroyed.length && !damage && !won && !midBoss) return null
  return { state: next, damage, destroyed, won, midBoss }
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

/** Kein Lernen oder Spielen: Verfall, Nachträge, Meilensteine, Lane tauschen */
const NOT_PLAYED: ReadonlySet<SoulsReason> = new Set<SoulsReason>(['decay', 'history', 'milestone', 'star', 'swap'])

/** Trophäen je Patron bei so vielen Siegen */
export const TROPHY_WINS = [1, 5, 10, 25, 50]

/** Serien-Bonus beim Sieg: je Tag der Siegesserie, höchstens … (Revanche: doppelt) */
export const STREAK_BONUS_PER_DAY = 10
export const STREAK_BONUS_MAX = 100

export function streakBonus(streak: number, revenge: boolean): number {
  return Math.min(STREAK_BONUS_MAX, STREAK_BONUS_PER_DAY * streak) * (revenge ? 2 : 1)
}

export interface LaneDay extends LaneDayInfo {
  date: string
  won: boolean
  /** Derselbe Patron wie bei der Niederlage davor */
  revenge: boolean
  /** Held des Tages beim Sieg (Hero-Karten-ID) */
  hero?: string
  /** Niederlage, bei der der Rejuvenator die Siegesserie geschützt hat */
  saved?: boolean
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
  /** Siege je Held des Tages (Hero-Karten-ID) */
  byHero: Record<string, number>
  /** Wie oft der Rejuvenator die Serie gerettet hat */
  saves: number
}

export interface LaneHistory {
  days: LaneDay[]
  summary: LaneSummary
  /** Heute: Gegner (Revanche) und Rejuvenator auf Vorrat */
  today: { patron: Patron; revenge: boolean; rejuvenator: boolean }
}

type HistoryEntry = Pick<SoulsEntry, 'date' | 'reason'> & { data?: SoulsEntry['data'] }

/**
 * Gezählte Tage ab dem ersten Tag mit Lane-Angriff: Sieg = Bonus für alle drei Missionen; Niederlage = gelernt oder
 * gespielt, ohne zu gewinnen – heute erst, wenn der Tag vorbei ist. Tage ohne Lernen und Spielen zählen nicht.
 * Nach einer Niederlage kommt derselbe Patron wieder (Revanche). Ein besiegter Mid Boss legt einen Rejuvenator auf
 * Vorrat (höchstens einen), der die Serie bei der nächsten Niederlage schützt.
 */
export function laneHistory(entries: readonly HistoryEntry[], start: string | null | undefined, today: string): LaneHistory {
  const byPatron: Record<Patron, LaneRecord> = { hiddenKing: { wins: 0, losses: 0 }, archmother: { wins: 0, losses: 0 } }
  const summary: LaneSummary = { wins: 0, losses: 0, streak: 0, best: 0, byPatron, byHero: {}, saves: 0 }
  const days: LaneDay[] = []
  const won = new Map<string, HistoryEntry['data']>()
  const played = new Set<string>()
  const boss = new Set<string>()
  /** Getauschte Lanes je Tag */
  const swapped = new Map<string, Lane>()
  if (start) {
    for (const e of entries) {
      if (e.date < start || e.date > today) continue
      if (e.reason === 'missions') won.set(e.date, e.data)
      else if (!NOT_PLAYED.has(e.reason) && e.date < today) played.add(e.date)
      if (e.reason === 'midboss') boss.add(e.date)
      if (e.reason === 'swap' && isAttackLane(e.data?.lane)) swapped.set(e.date, e.data.lane)
    }
  }
  let stock = false
  let previous: LaneDay | undefined
  for (const date of [...new Set([...won.keys(), ...played])].sort()) {
    const base = laneForDay(date)
    const isWon = won.has(date)
    const record = won.get(date)
    // Ein Sieg zählt gegen den Gegner, gegen den er errungen wurde (beim Sieg gespeichert –
    // ältere Siege ohne Angabe: der Patron des Tages, damals noch ohne Revanche)
    const revenge = isWon ? record?.revenge === true : !!previous && !previous.won
    const patron = isWon ? (isPatron(record?.patron) ? record.patron : base.patron) : revenge ? previous!.patron : base.patron
    if (boss.has(date)) stock = true
    const lane = isWon && isAttackLane(record?.lane) ? record.lane : swapped.get(date) ?? base.lane
    const day: LaneDay = { date, lane, patron, won: isWon, revenge }
    if (day.won) {
      summary.streak++
      summary.best = Math.max(summary.best, summary.streak)
      byPatron[patron].wins++
      const hero = won.get(date)?.hero
      if (typeof hero === 'string') {
        day.hero = hero
        summary.byHero[hero] = (summary.byHero[hero] ?? 0) + 1
      }
    } else {
      byPatron[patron].losses++
      if (stock) {
        stock = false
        day.saved = true
        summary.saves++
      } else {
        summary.streak = 0
      }
    }
    days.push(day)
    previous = day
  }
  summary.wins = byPatron.hiddenKing.wins + byPatron.archmother.wins
  summary.losses = byPatron.hiddenKing.losses + byPatron.archmother.losses
  const last = days.at(-1)
  const todayInfo = last?.date === today
    ? { patron: last.patron, revenge: last.revenge, rejuvenator: stock }
    : {
        patron: last && !last.won ? last.patron : laneForDay(today).patron,
        revenge: !!last && !last.won,
        rejuvenator: stock || boss.has(today),
      }
  return { days, summary, today: todayInfo }
}

/** Stand-Angaben für heute aus dem Verlauf (Gegner, Revanche, Rejuvenator, Serie, Trophäe) */
export function laneContextOf(history: LaneHistory, today: string): Omit<LaneContext, 'hero' | 'midBoss'> {
  const wonToday = history.days.at(-1)?.date === today && history.days.at(-1)!.won
  const wins = history.summary.byPatron[history.today.patron].wins
  return {
    ...history.today,
    streak: history.summary.streak,
    ...(wonToday && TROPHY_WINS.includes(wins) ? { trophy: wins } : {}),
  }
}

export async function loadLaneHistory(now = new Date(), database: DeckDB = db): Promise<LaneHistory> {
  const [entries, start] = await Promise.all([database.souls.toArray(), getMeta<string | null>('laneStart', null, database)])
  return laneHistory(entries, start, localDate(now))
}

export async function getLaneSummary(now = new Date(), database: DeckDB = db): Promise<LaneSummary> {
  return (await loadLaneHistory(now, database)).summary
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
