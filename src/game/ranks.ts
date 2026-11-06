/**
 * Rang aus der Souls-Summe – mit den echten Deadlock-Rängen (deutsche Namen und Abzeichen aus der API).
 * Start bei „Unwissender“ (Obscurus), Novize 1 ab 100 Souls, dann 65 Stufen bis Ewiger 6.
 * Die Kosten je Stufe steigen von 800 auf 3.200 Souls: bei ~650 Souls am Tag anfangs ein Aufstieg
 * alle 1–2 Tage, am Ende etwa einer pro Woche – Ewiger 6 nach rund einem halben Jahr.
 */

export interface RankStep {
  /** 1 (Novize) … 11 (Ewiger) */
  tier: number
  /** Unterstufe 1–6 */
  sub: number
  /** Souls, ab denen die Stufe erreicht ist */
  souls: number
}

export const FIRST_RANK_SOULS = 100
export const SUBRANKS = 6
export const TOP_TIER = 11

/** Kosten der Stufe i (1 … 65), auf 50 gerundet: 800 → 3.200 */
export function stepCost(i: number): number {
  return Math.round((762.5 + 37.5 * i) / 50) * 50
}

export const RANK_STEPS: readonly RankStep[] = (() => {
  const steps: RankStep[] = []
  let souls = FIRST_RANK_SOULS
  for (let i = 0; i < TOP_TIER * SUBRANKS; i++) {
    if (i > 0) souls += stepCost(i)
    steps.push({ tier: 1 + Math.floor(i / SUBRANKS), sub: 1 + (i % SUBRANKS), souls })
  }
  return steps
})()

export interface RankState {
  /** 0 = Unwissender (noch kein Rang) */
  tier: number
  sub: number
  /** Index in RANK_STEPS; -1 = Unwissender */
  index: number
  /** Souls-Schwelle der aktuellen Stufe */
  floor: number
  /** Nächste Stufe (fehlt bei Ewiger 6) */
  next?: RankStep
  /** Fortschritt bis zur nächsten Stufe, 0–1 */
  progress: number
}

export function rankForSouls(total: number): RankState {
  let index = -1
  for (let i = 0; i < RANK_STEPS.length && RANK_STEPS[i].souls <= total; i++) index = i
  const current = index >= 0 ? RANK_STEPS[index] : undefined
  const floor = current?.souls ?? 0
  const next = RANK_STEPS[index + 1]
  const progress = next ? Math.min(1, Math.max(0, (total - floor) / (next.souls - floor))) : 1
  return { tier: current?.tier ?? 0, sub: current?.sub ?? 0, index, floor, next, progress }
}

/** Rang-Infos aus der API (gespeichert beim Sync) */
export interface RankAsset {
  tier: number
  name: string
  /** Abzeichen ohne Unterstufe */
  image?: string
  /** Abzeichen je Unterstufe 1–6 (Index = Unterstufe − 1) */
  subImages: (string | undefined)[]
}

/** Deutsche Namen der API – falls die Rang-Daten (noch) fehlen */
export const RANK_NAMES_DE = [
  'Unwissender', 'Novize', 'Kultist', 'Akolyth', 'Wächter', 'Mystiker',
  'Ritualist', 'Emissär', 'Orakel', 'Phantom', 'Aszendent', 'Ewiger',
]

export function rankName(tier: number, assets: readonly RankAsset[] = []): string {
  return assets.find(a => a.tier === tier)?.name ?? RANK_NAMES_DE[tier] ?? `Rang ${tier}`
}

/** „Orakel 3“ bzw. „Unwissender“ */
export function rankLabel(rank: Pick<RankState, 'tier' | 'sub'>, assets: readonly RankAsset[] = []): string {
  return rank.tier === 0 ? rankName(0, assets) : `${rankName(rank.tier, assets)} ${rank.sub}`
}

export function rankImage(rank: Pick<RankState, 'tier' | 'sub'>, assets: readonly RankAsset[] = []): string | undefined {
  const asset = assets.find(a => a.tier === rank.tier)
  if (!asset) return undefined
  return (rank.sub > 0 ? asset.subImages[rank.sub - 1] : undefined) ?? asset.image
}

/** Teilmenge von /v1/assets/ranks */
export interface ApiRank {
  tier: number
  name: string
  images?: Record<string, string | undefined> | null
}

export function parseRanks(api: readonly ApiRank[]): RankAsset[] {
  return api
    .filter(r => typeof r.tier === 'number' && r.name)
    .map(r => ({
      tier: r.tier,
      name: r.name,
      image: r.images?.large_webp ?? r.images?.large,
      subImages: Array.from({ length: SUBRANKS }, (_, i) => r.images?.[`large_subrank${i + 1}_webp`] ?? r.images?.[`large_subrank${i + 1}`]),
    }))
}
