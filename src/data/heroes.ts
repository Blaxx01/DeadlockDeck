import type { ApiHero, ApiItem, ApiItemProperty, ApiStatValue } from './apiTypes'
import type { AbilityCard, AbilityRef, AbilityUpgrade, HeroCard, Stat, Timing, TimingKind } from './model'
import { bonusPairs, makeFingerprint, normValue, propertyValues } from './fingerprint'
import { formatPropertyValue, isPropertyVisible, replacePlaceholders } from './normalize'

const SIGNATURE_SLOTS = ['signature1', 'signature2', 'signature3', 'signature4'] as const

/** Kosten der drei Ability-Upgrades in Ability-Punkten (Spielregel, nicht in der API) */
export const ABILITY_UPGRADE_COSTS = [1, 2, 5]

const ABILITY_TIMINGS: { key: string; kind: TimingKind; fallback: string }[] = [
  { key: 'AbilityCooldown', kind: 'cooldown', fallback: 'Abklingzeit' },
  { key: 'AbilityDuration', kind: 'duration', fallback: 'Dauer' },
  { key: 'AbilityCastRange', kind: 'range', fallback: 'Reichweite' },
  { key: 'AbilityCharges', kind: 'charges', fallback: 'Aufladungen' },
]
const TIMING_KEYS = new Set([...ABILITY_TIMINGS.map(t => t.key), 'AbilityCooldownBetweenCharge', 'AbilityChargeUpTime', 'AbilityChannelTime', 'AbilityCastDelay'])

const HERO_STATS: { key: string; label: string; unit?: string; sign?: boolean }[] = [
  { key: 'max_health', label: 'Leben' },
  { key: 'base_health_regen', label: 'Lebensregeneration', unit: '/s' },
  { key: 'max_move_speed', label: 'Lauftempo', unit: ' m/s' },
  { key: 'sprint_speed', label: 'Sprinttempo', unit: ' m/s', sign: true },
  { key: 'stamina', label: 'Ausdauer' },
  { key: 'light_melee_damage', label: 'Leichter Nahkampf' },
  { key: 'heavy_melee_damage', label: 'Schwerer Nahkampf' },
]

export function isPlayableHero(hero: ApiHero): boolean {
  return !!hero.player_selectable && !hero.disabled && !hero.in_development
}

/** Entfernt eingebettete SVG-Icons und ersetzt Tastenplatzhalter. */
export function cleanHtml(html: string | null | undefined): string | undefined {
  if (!html) return undefined
  const cleaned = replacePlaceholders(html.replace(/<svg[\s\S]*?<\/svg>/gi, '')).trim()
  return cleaned || undefined
}

function toNumber(value: unknown): number | null {
  const n = Number.parseFloat(String(value ?? ''))
  return Number.isFinite(n) ? n : null
}

function statNumber(value: ApiStatValue | undefined): number | null {
  if (value && typeof value === 'object') return toNumber(value.value)
  return toNumber(value)
}

/** 8.2 → "8.2", 2.0 → "2", 5.263 → "5.26" */
function num(n: number): string {
  return String(Math.round(n * 100) / 100)
}

function heroStats(hero: ApiHero): Stat[] {
  const stats: Stat[] = []
  for (const { key, label, unit = '', sign } of HERO_STATS) {
    const n = statNumber(hero.starting_stats?.[key])
    if (n === null || n === 0) continue
    stats.push({ label, value: `${sign && n > 0 ? '+' : ''}${num(n)}${unit}` })
  }
  return stats
}

function weaponOf(hero: ApiHero, itemsByClass: Map<string, ApiItem>, itemsById: Map<number, ApiItem>): HeroCard['weapon'] {
  const ref = hero.items?.weapon_primary
  const weapon = typeof ref === 'number' ? itemsById.get(ref) : ref ? itemsByClass.get(ref) : undefined
  const info = weapon?.weapon_info
  if (!weapon || !info) return undefined
  const stats: Stat[] = []
  const damage = toNumber(info.bullet_damage)
  const bullets = toNumber(info.bullets) ?? 1
  if (damage) stats.push({ label: 'Kugelschaden', value: `${num(damage)}${bullets > 1 ? ` × ${bullets}` : ''}` })
  const clip = toNumber(info.clip_size)
  if (clip) stats.push({ label: 'Magazin', value: num(clip) })
  const reload = toNumber(info.reload_duration)
  if (reload) stats.push({ label: 'Nachladen', value: `${num(reload)} s` })
  return { name: weapon.name, stats }
}

function abilityTimings(props: Record<string, ApiItemProperty>): Timing[] {
  const result: Timing[] = []
  for (const { key, kind, fallback } of ABILITY_TIMINGS) {
    const prop = props[key]
    if (!isPropertyVisible(prop)) continue
    // „0“ oder „1“ Aufladung heißt: keine Aufladungen
    if (kind === 'charges' && (toNumber(prop.value) ?? 0) <= 1) continue
    result.push({ label: prop.label?.trim() || fallback, value: formatPropertyValue(prop), kind })
  }
  return result
}

/** Wichtige und weitere Werte aus den Tooltip-Abschnitten, ohne Zeiten und Status-Symbole. */
function abilityStats(ability: ApiItem): Stat[] {
  const props = ability.properties ?? {}
  const keys: string[] = []
  for (const section of ability.tooltip_details?.info_sections ?? []) {
    for (const block of section.properties_block ?? []) {
      for (const p of block.properties ?? []) if (p.important_property) keys.push(p.important_property)
    }
    keys.push(...(section.basic_properties ?? []))
  }
  const stats: Stat[] = []
  for (const key of new Set(keys)) {
    if (TIMING_KEYS.has(key) || key.startsWith('StatusEffect')) continue
    const prop = props[key]
    if (!isPropertyVisible(prop) || !prop.label?.trim()) continue
    stats.push({
      label: prop.label.trim(),
      value: formatPropertyValue(prop),
      negative: prop.negative_attribute === true || undefined,
      conditional: !!prop.conditional || undefined,
    })
  }
  return stats
}

/** Upgrade-Texte: fertiger deutscher Text der API, sonst aus den Upgrade-Werten gebaut. */
function abilityUpgrades(ability: ApiItem): AbilityUpgrade[] {
  const desc = (ability.description && typeof ability.description === 'object' ? ability.description : {}) as Record<string, string | null | undefined>
  const props = ability.properties ?? {}
  const result: AbilityUpgrade[] = []
  ABILITY_UPGRADE_COSTS.forEach((cost, i) => {
    let html = cleanHtml(desc[`t${i + 1}_desc`])
    if (!html) {
      const parts = (ability.upgrades?.[i]?.property_upgrades ?? []).flatMap(up => {
        const prop = props[up.name]
        const bonus = toNumber(up.bonus)
        if (!prop?.label?.trim() || bonus === null || bonus === 0) return []
        const unit = prop.postfix ?? ''
        return [`<span class="highlight">${bonus > 0 ? '+' : ''}${num(bonus)}${unit}</span> ${prop.label.trim()}`]
      })
      html = parts.join('<br>') || undefined
    }
    if (html) result.push({ cost, html })
  })
  return result
}

function abilityText(ability: ApiItem): { html?: string; quip?: string } {
  const desc = (ability.description && typeof ability.description === 'object' ? ability.description : {}) as Record<string, string | null | undefined>
  const text = typeof ability.description === 'string' ? ability.description : desc.desc
  const html = cleanHtml(text)
    ?? cleanHtml((ability.tooltip_details?.info_sections ?? []).map(s => s.loc_string).filter(Boolean).join('<br>'))
  return { html, quip: cleanHtml(desc.quip) }
}

function resolve(ref: string | number | null | undefined, byClass: Map<string, ApiItem>, byId: Map<number, ApiItem>): ApiItem | undefined {
  if (typeof ref === 'number') return byId.get(ref)
  return ref ? byClass.get(ref) : undefined
}

const WEAPON_FINGERPRINT_KEYS = ['bullet_damage', 'bullets', 'clip_size', 'reload_duration', 'cycle_time', 'burst_shot_count', 'intra_burst_cycle_time']

/**
 * Baut die Hero- und Ability-Karten. Namen englisch (wie ingame), Texte deutsch
 * (Fallback englisch). Nur spielbare Heroes; Abilities aus signature1–4.
 */
export function buildHeroDecks(
  heroesEn: ApiHero[],
  heroesDe: ApiHero[],
  itemsEn: ApiItem[],
  itemsDe: ApiItem[],
): { heroes: HeroCard[]; abilities: AbilityCard[] } {
  const heroDe = new Map(heroesDe.map(h => [h.id, h]))
  const enByClass = new Map(itemsEn.map(i => [i.class_name, i]))
  const enById = new Map(itemsEn.map(i => [i.id, i]))
  const deByClass = new Map(itemsDe.map(i => [i.class_name, i]))
  const deById = new Map(itemsDe.map(i => [i.id, i]))

  const playable = heroesEn.filter(isPlayableHero).sort((a, b) => a.name.localeCompare(b.name))
  const heroes: HeroCard[] = []
  const abilities: AbilityCard[] = []

  playable.forEach((en, index) => {
    const de = heroDe.get(en.id) ?? en
    const image = en.images?.icon_hero_card_webp || en.images?.icon_hero_card || undefined
    const smallImage = en.images?.icon_image_small_webp || en.images?.icon_image_small || undefined
    const poses = (['icon_hero_card', 'hero_card_critical', 'hero_card_gloat'] as const)
      .map(k => en.images?.[`${k}_webp`] || en.images?.[k] || undefined)
      .filter((u): u is string => !!u)
    const color = en.colors?.style_hex || undefined
    const refs: AbilityRef[] = []

    SIGNATURE_SLOTS.forEach((slotKey, i) => {
      const abilityEn = resolve(en.items?.[slotKey], enByClass, enById)
      if (!abilityEn) return
      const abilityDe = resolve(en.items?.[slotKey], deByClass, deById) ?? abilityEn
      const slot = i + 1
      const id = `ability:${abilityEn.class_name}`
      const abilityImage = abilityEn.image_webp || abilityEn.image || undefined
      refs.push({ id, name: abilityEn.name, image: abilityImage, slot })
      const ability: Omit<AbilityCard, 'fingerprint'> = {
        id,
        className: abilityEn.class_name,
        name: abilityEn.name,
        heroId: en.id,
        heroName: en.name,
        heroImage: smallImage,
        heroColor: color,
        slot,
        order: index * 10 + slot,
        image: abilityImage,
        ...abilityText(abilityDe),
        timings: abilityTimings(abilityDe.properties ?? {}),
        stats: abilityStats(abilityDe),
        upgrades: abilityUpgrades(abilityDe),
      }
      abilities.push({
        ...ability,
        fingerprint: makeFingerprint({
          values: propertyValues(abilityEn.properties, isPropertyVisible),
          upgrades: (abilityEn.upgrades ?? []).map(u => bonusPairs(u.property_upgrades)),
        }),
      })
    })

    const hero: Omit<HeroCard, 'fingerprint'> = {
      id: `hero:${en.class_name}`,
      heroId: en.id,
      className: en.class_name,
      name: en.name,
      order: index,
      image,
      smallImage,
      poses,
      color,
      role: cleanHtml(de.description?.role),
      playstyle: cleanHtml(de.description?.playstyle),
      tags: (de.tags ?? en.tags ?? []).filter(Boolean),
      gunTag: de.gun_tag || en.gun_tag || undefined,
      complexity: en.complexity ?? undefined,
      stats: heroStats(en),
      weapon: weaponOf(en, enByClass, enById),
      abilities: refs,
    }
    const weaponInfo = resolve(en.items?.weapon_primary, enByClass, enById)?.weapon_info ?? {}
    heroes.push({
      ...hero,
      fingerprint: makeFingerprint({
        stats: HERO_STATS.map(({ key }) => [key, normValue(statNumber(en.starting_stats?.[key]))]),
        weapon: WEAPON_FINGERPRINT_KEYS.map(k => [k, normValue(weaponInfo[k])]),
        abilities: SIGNATURE_SLOTS.map(slot => String(en.items?.[slot] ?? '')),
      }),
    })
  })

  return { heroes, abilities }
}
