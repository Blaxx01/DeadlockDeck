/**
 * Rang-Übersicht: alle Ränge mit Souls-Schwelle, wo du stehst und was ein Rang bei den Tagesmissionen freischaltet.
 */
import { LEVEL_TIERS, LEVEL_UNLOCKS, missionLevel, type MissionLevel } from './missionLevels'
import { RANK_STEPS, rankForSouls, TOP_TIER } from './ranks'

/** reached = schon erreicht (auch vor einem Verfall), current = aktueller Rang, open = noch nicht erreicht */
export type LadderState = 'reached' | 'current' | 'open'

export interface LadderTier {
  /** 0 = Unwissender … 11 = Ewiger */
  tier: number
  /** Souls ab Unterstufe 1 (Unwissender: 0) */
  souls: number
  state: LadderState
  /** Noch nicht erreicht: fehlende Souls vom Kontostand aus */
  missing?: number
  /** Freischaltung bei den Tagesmissionen (Kultist, Akolyth, Wächter) – frei ab dem höchsten erreichten Rang */
  unlock?: { text: string; unlocked: boolean }
}

/** Alle Ränge von Unwissender bis Ewiger. `best`: höchster je erreichter Kontostand */
export function rankLadder(total: number, best: number): LadderTier[] {
  const top = Math.max(best, total)
  const current = rankForSouls(total).tier
  const bestTier = rankForSouls(top).tier
  const level = missionLevel(top)
  return Array.from({ length: TOP_TIER + 1 }, (_, tier): LadderTier => {
    const souls = tier === 0 ? 0 : RANK_STEPS.find(s => s.tier === tier && s.sub === 1)!.souls
    const state: LadderState = tier === current ? 'current' : tier <= bestTier ? 'reached' : 'open'
    const unlockLevel = LEVEL_TIERS.indexOf(tier)
    return {
      tier, souls, state,
      ...(state === 'open' ? { missing: souls - total } : {}),
      ...(unlockLevel > 0
        ? { unlock: { text: LEVEL_UNLOCKS[unlockLevel as Exclude<MissionLevel, 0>], unlocked: level >= unlockLevel } }
        : {}),
    }
  })
}
