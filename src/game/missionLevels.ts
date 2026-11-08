/**
 * Missions-Stufen: Die Tagesmissionen richten sich nach dem höchsten je erreichten Rang – am Anfang leichte Ziele,
 * Sprint und Hero erraten ab Kultist 1, Build-Quiz ab Akolyth 1, ab Wächter 1 die vollen Ziele.
 * Dazu der Preis fürs Lane-Tauschen: ein Viertel der Kosten der nächsten Rangstufe.
 */
import { RANK_STEPS, rankForSouls, stepCost } from './ranks'

/** 0 = Start … 3 = volle Ziele */
export type MissionLevel = 0 | 1 | 2 | 3

export const LEVELS: readonly MissionLevel[] = [0, 1, 2, 3]
export const TOP_LEVEL: MissionLevel = 3

/** Rang (Tier, Unterstufe 1), ab dem eine Stufe gilt: Start, Kultist, Akolyth, Wächter */
export const LEVEL_TIERS: readonly number[] = [0, 2, 3, 4]

export function missionLevel(bestSouls: number): MissionLevel {
  const { tier } = rankForSouls(bestSouls)
  let level: MissionLevel = 0
  for (const l of LEVELS) if (tier >= LEVEL_TIERS[l]) level = l
  return level
}

export function asLevel(value: unknown): MissionLevel | undefined {
  return LEVELS.includes(value as MissionLevel) ? (value as MissionLevel) : undefined
}

/** Souls, ab denen eine Stufe gilt */
export function levelSouls(level: MissionLevel): number {
  if (level === 0) return 0
  return RANK_STEPS.find(s => s.tier === LEVEL_TIERS[level] && s.sub === 1)!.souls
}

/** Was eine Stufe bei den Tagesmissionen freischaltet */
export const LEVEL_UNLOCKS: Readonly<Record<Exclude<MissionLevel, 0>, string>> = {
  1: 'Sprint und Hero erraten',
  2: 'Build-Quiz und Quiz-Punkte',
  3: 'die vollen Ziele (z. B. Build-Quiz ohne Fehler)',
}

/** Held des Tages mit allen Karten gelernt: Build-Quiz mit höchstens so vielen Fehlern (null = noch kein Build-Quiz) */
export const HERO_BUILD_ERRORS: readonly (number | null)[] = [null, null, 4, 2]

export interface NextUnlock {
  level: MissionLevel
  /** Rang mit Unterstufe 1 */
  tier: number
  souls: number
  /** Fehlende Souls bis dahin (vom höchsten Stand aus) */
  missing: number
  text: string
}

/** Nächste Freischaltung – fehlt auf der höchsten Stufe */
export function nextUnlock(bestSouls: number): NextUnlock | undefined {
  const level = missionLevel(bestSouls)
  if (level >= TOP_LEVEL) return undefined
  const next = (level + 1) as Exclude<MissionLevel, 0>
  const souls = levelSouls(next)
  return { level: next, tier: LEVEL_TIERS[next], souls, missing: Math.max(0, souls - bestSouls), text: LEVEL_UNLOCKS[next] }
}

/** Was zwischen zwei Ständen neu freigeschaltet wird (für „Aufstieg!“) */
export function unlocksBetween(beforeSouls: number, afterSouls: number): string[] {
  const from = missionLevel(beforeSouls)
  const to = missionLevel(afterSouls)
  return LEVELS.filter(l => l > from && l <= to).map(l => LEVEL_UNLOCKS[l as Exclude<MissionLevel, 0>])
}

export const SWAP_MIN = 200
export const SWAP_MAX = 800

/** Lane tauschen: ein Viertel der Kosten der nächsten Rangstufe, auf 10 gerundet (200–800 ◆) – bewusst teuer */
export function swapPrice(total: number): number {
  const rank = rankForSouls(total)
  const cost = rank.next ? rank.next.souls - rank.floor : stepCost(RANK_STEPS.length - 1)
  return Math.min(SWAP_MAX, Math.max(SWAP_MIN, Math.round(cost / 40) * 10))
}
