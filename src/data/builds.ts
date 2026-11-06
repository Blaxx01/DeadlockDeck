/**
 * Builds fürs Build-Quiz aus der Deadlock-API:
 * - Typisch: die 16 meistgekauften Items eines Heroes (ab Orakel), nach ⌀ Kaufzeit in Früh/Mitte/Spät
 * - Community: der in Matches ab Orakel meistgespielte Build, nur seine Pflicht-Abschnitte
 */
import type { ApiItemStat } from './counters'
import type { BuildItem, BuildRecord, BuildSection, HeroCard, ItemCard } from './model'

export const TYPICAL_SIZE = 16
/** Kaufzeit-Grenzen der Abschnitte des typischen Builds (Sekunden) */
export const EARLY_UNTIL_S = 600
export const MID_UNTIL_S = 1200
/** So viele Matches braucht ein Hero (ab Orakel, 30 Tage), damit sein typischer Build zählt */
export const MIN_HERO_MATCHES = 1000
/** So oft muss der meistgespielte Community-Build gespielt worden sein */
export const MIN_BUILD_MATCHES = 50
/** Kleinere Community-Builds sind keine sinnvolle Runde */
export const MIN_COMMUNITY_ITEMS = 6
/** Ausreißer (z. B. 61 Pflicht-Items) werden auf die ersten 30 gekürzt */
export const MAX_COMMUNITY_ITEMS = 30

/** Teilmenge von /v1/analytics/hero-stats */
export interface ApiHeroStat {
  hero_id: number
  matches: number
}

/** Teilmenge von /v1/analytics/hero-build-stats/{hero_id} */
export interface ApiHeroBuildStat {
  hero_build_id: number
  matches: number
}

/** Teilmenge eines Builds von /v1/builds */
export interface ApiBuild {
  hero_build: {
    hero_id: number
    hero_build_id: number
    name?: string | null
    last_updated_timestamp?: number | null
    details?: {
      mod_categories?: {
        name?: string | null
        optional?: boolean | null
        mods?: { ability_id: number }[] | null
      }[] | null
    } | null
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100

function shopItemsByApiId(items: readonly ItemCard[]): Map<number, ItemCard> {
  return new Map(items.filter(i => typeof i.apiId === 'number').map(i => [i.apiId, i]))
}

function heroFields(hero: HeroCard) {
  return { heroId: hero.heroId, heroName: hero.name, image: hero.image, smallImage: hero.smallImage, color: hero.color }
}

/**
 * Typische Builds: je Hero die 16 Items, die in den meisten seiner Matches gekauft werden,
 * sortiert nach ⌀ Kaufzeit und in Früh (bis 10 min) / Mitte (10–20 min) / Spät eingeteilt.
 */
export function computeTypicalBuilds(
  rows: readonly ApiItemStat[],
  heroStats: readonly ApiHeroStat[],
  items: readonly ItemCard[],
  heroes: readonly HeroCard[],
  now: number,
): BuildRecord[] {
  const itemByApiId = shopItemsByApiId(items)
  const heroMatches = new Map(heroStats.map(h => [h.hero_id, h.matches]))
  const rowsByHero = new Map<number, ApiItemStat[]>()
  for (const r of rows) {
    if (!itemByApiId.has(r.item_id) || r.matches <= 0) continue
    const list = rowsByHero.get(r.bucket) ?? []
    list.push(r)
    rowsByHero.set(r.bucket, list)
  }

  const builds: BuildRecord[] = []
  for (const hero of heroes) {
    const total = heroMatches.get(hero.heroId) ?? 0
    const top = (rowsByHero.get(hero.heroId) ?? [])
      .sort((a, b) => b.matches - a.matches || a.item_id - b.item_id)
      .slice(0, TYPICAL_SIZE)
    if (total < MIN_HERO_MATCHES || top.length < TYPICAL_SIZE) continue
    const buyTime = (r: ApiItemStat) => r.avg_buy_time_s ?? Number.POSITIVE_INFINITY
    top.sort((a, b) => buyTime(a) - buyTime(b))
    const toItem = (r: ApiItemStat): BuildItem => ({
      itemId: itemByApiId.get(r.item_id)!.id,
      pick: Math.min(1, round2(r.matches / total)),
      buyTime: r.avg_buy_time_s === undefined ? undefined : Math.round(r.avg_buy_time_s),
    })
    const sections: BuildSection[] = [
      { title: 'Früh', items: top.filter(r => buyTime(r) < EARLY_UNTIL_S).map(toItem) },
      { title: 'Mitte', items: top.filter(r => buyTime(r) >= EARLY_UNTIL_S && buyTime(r) < MID_UNTIL_S).map(toItem) },
      { title: 'Spät', items: top.filter(r => buyTime(r) >= MID_UNTIL_S).map(toItem) },
    ].filter(s => s.items.length > 0)
    builds.push({ id: `typical:${hero.className}`, source: 'typical', ...heroFields(hero), sections, updatedAt: now })
  }
  return builds
}

const SECTION_KEYS: Record<string, string> = {
  early: 'Früh',
  earlygame: 'Früh',
  lane: 'Lane',
  laning: 'Lane',
  laningphase: 'Lane',
  mid: 'Mitte',
  midgame: 'Mitte',
  late: 'Spät',
  lategame: 'Spät',
  situational: 'Situativ',
}

/** Abschnittsname eines Community-Builds: Platzhalter wie „#Citadel_HeroBuilds_EarlyGame“ → „Früh“ */
export function sectionTitle(name: string | null | undefined): string {
  const raw = (name ?? '').trim()
  if (!raw) return 'Weitere Items'
  const key = /^#Citadel_HeroBuilds?_(\w+)$/i.exec(raw)?.[1]
  if (key) return SECTION_KEYS[key.toLowerCase()] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ')
  return raw.length > 48 ? `${raw.slice(0, 47)}…` : raw
}

/** Meistgespielter Build eines Heroes und sein Anteil an den ausgewerteten Matches */
export function pickTopBuild(stats: readonly ApiHeroBuildStat[]): { buildId: number; share: number } | null {
  let top: ApiHeroBuildStat | undefined
  let total = 0
  for (const s of stats) {
    total += s.matches
    if (!top || s.matches > top.matches) top = s
  }
  if (!top || top.matches < MIN_BUILD_MATCHES) return null
  return { buildId: top.hero_build_id, share: round2(top.matches / total) }
}

/** Community-Build: nur Pflicht-Abschnitte, unbekannte (entfernte) Items und Doppelte weg, höchstens 30 Items */
export function buildCommunityRecord(
  build: ApiBuild,
  hero: HeroCard,
  share: number,
  items: readonly ItemCard[],
  now: number,
): BuildRecord | null {
  const itemByApiId = shopItemsByApiId(items)
  const seen = new Set<string>()
  const sections: BuildSection[] = []
  for (const category of build.hero_build.details?.mod_categories ?? []) {
    if (category.optional) continue
    const list: BuildItem[] = []
    for (const mod of category.mods ?? []) {
      const item = itemByApiId.get(mod.ability_id)
      if (!item || seen.has(item.id) || seen.size >= MAX_COMMUNITY_ITEMS) continue
      seen.add(item.id)
      list.push({ itemId: item.id })
    }
    if (list.length) sections.push({ title: sectionTitle(category.name), items: list })
  }
  if (seen.size < MIN_COMMUNITY_ITEMS) return null
  const hb = build.hero_build
  return {
    id: `community:${hero.className}`,
    source: 'community',
    ...heroFields(hero),
    sections,
    buildName: hb.name?.trim() || 'Ohne Namen',
    buildId: hb.hero_build_id,
    share,
    lastUpdated: hb.last_updated_timestamp ? hb.last_updated_timestamp * 1000 : undefined,
    updatedAt: now,
  }
}

/** Anzahl Items eines Builds */
export function buildSize(build: BuildRecord): number {
  return build.sections.reduce((sum, s) => sum + s.items.length, 0)
}
