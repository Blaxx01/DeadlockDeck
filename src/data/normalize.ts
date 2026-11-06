import type { ApiCorruptedInfo, ApiGenericData, ApiItem, ApiItemProperty, ApiTooltipSection } from './apiTypes'
import { bonusPairs, makeFingerprint, propertyValues } from './fingerprint'
import type { CardSection, CorruptedInfo, CorruptedStat, ItemCard, SectionType, Stat, Timing, TimingKind } from './model'

export { hashString } from './fingerprint'

/** Zeit-/Reichweiten-Werte, die oben auf der Karte stehen statt in den Abschnitten. */
const TIMING_KEYS: { key: string; kind: TimingKind; fallback: string }[] = [
  { key: 'AbilityCooldown', kind: 'cooldown', fallback: 'Cooldown' },
  { key: 'ProcCooldown', kind: 'cooldown', fallback: 'Cooldown' },
  { key: 'AbilityDuration', kind: 'duration', fallback: 'Dauer' },
  { key: 'AbilityCastRange', kind: 'range', fallback: 'Reichweite' },
]
const TIMING_KEY_SET = new Set(['AbilityChargeUpTime', 'AbilityCooldownBetweenCharge', ...TIMING_KEYS.map(t => t.key)])

export function isPropertyVisible(prop: ApiItemProperty | undefined): prop is ApiItemProperty {
  if (!prop || prop.value === null || prop.value === undefined || prop.value === '') return false
  if (prop.disable_value !== undefined && prop.disable_value !== null) {
    return String(prop.value) !== String(prop.disable_value)
  }
  return String(prop.value) !== '0'
}

export function formatPropertyValue(prop: ApiItemProperty): string {
  let value = String(prop.value ?? '')
  const postfix = prop.postfix ?? ''
  const unit = postfix.trim()
  // Die API liefert Werte teils schon mit Einheit ("2m", "30m"). Gibt es eine Einheit
  // im postfix, gilt nur diese – sonst entstünde "2m m/s".
  const withUnit = value.match(/^([+-]?\d+(?:\.\d+)?)\s*[a-zA-Z/]+$/)
  if (unit && withUnit) value = withUnit[1]
  const num = Number.parseFloat(value)
  const sign = Number.isFinite(num) && num >= 0 ? '+' : ''
  const prefix = prop.prefix?.replace('{s:sign}', sign) ?? ''
  const suffix = unit && value.endsWith(unit) ? '' : postfix
  return `${prefix}${value}${suffix}`
}

/** "BonusFireRate" → "Bonus Fire Rate" (nur, wenn die API kein Label liefert) */
function humanizeKey(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2')
}

function toStat(key: string, prop: ApiItemProperty, fallbackLabel?: string): Stat {
  return {
    label: prop.label?.trim() || fallbackLabel || humanizeKey(key),
    value: formatPropertyValue(prop),
    negative: prop.negative_attribute === true || undefined,
    conditional: !!prop.conditional || undefined,
  }
}

/** Ersetzt Tastenbelegungs-Platzhalter wie {g:citadel_binding:'Reload'} durch den Namen. */
export function replacePlaceholders(text: string): string {
  return text.replace(
    /\{g:citadel_(?:binding|keybind):(?:'([^']+)'|"([^"]+)"|([^}]+))\}/g,
    (_m, a: string | undefined, b: string | undefined, c: string | undefined) =>
      `<span class="key">${(a ?? b ?? c ?? '').trim().replace(/^Default\./, '')}</span>`,
  )
}

function buildSections(item: ApiItem): CardSection[] {
  const props = item.properties ?? {}
  const sections: CardSection[] = []
  for (const section of item.tooltip_sections ?? []) {
    const type: SectionType = section.section_type ?? 'passive'
    sections.push(...buildSection(type, section, props))
  }
  // Fallback: keine Beschreibung in den Abschnitten → description-Feld verwenden
  if (!sections.some(s => s.html)) {
    const desc = typeof item.description === 'string'
      ? item.description
      : Object.values(item.description ?? {}).filter(Boolean).join('<br>')
    if (desc) {
      const type: SectionType = item.is_active_item ? 'active' : 'passive'
      const target = sections.find(s => s.type === type)
      if (target) target.html = replacePlaceholders(desc)
      else sections.push({ type, html: replacePlaceholders(desc), stats: [] })
    }
  }
  return sections.filter(s => s.html || s.stats.length)
}

function buildSection(type: SectionType, section: ApiTooltipSection, props: Record<string, ApiItemProperty>): CardSection[] {
  const htmlParts: string[] = []
  const seen = new Set<string>()
  const stats: Stat[] = []
  for (const attr of section.section_attributes ?? []) {
    if (attr.loc_string) htmlParts.push(replacePlaceholders(attr.loc_string))
    const keys = [
      ...(attr.important_properties ?? []),
      ...(attr.elevated_properties ?? []),
      ...(attr.properties ?? []),
    ]
    for (const key of keys) {
      if (seen.has(key) || TIMING_KEY_SET.has(key)) continue
      seen.add(key)
      const prop = props[key]
      if (isPropertyVisible(prop)) stats.push(toStat(key, prop))
    }
  }
  return [{ type, html: htmlParts.join('<br>') || undefined, stats }]
}

function buildTimings(item: ApiItem): Timing[] {
  const props = item.properties ?? {}
  const result: Timing[] = []
  const usedKinds = new Set<TimingKind>()
  for (const { key, kind, fallback } of TIMING_KEYS) {
    const prop = props[key]
    if (!isPropertyVisible(prop) || usedKinds.has(kind)) continue
    usedKinds.add(kind)
    result.push({ ...toStat(key, prop, fallback), kind })
  }
  return result
}

/**
 * Deutsche Namen der Broker-Nachteile je Effekt (die API liefert nur englische Labels).
 * Achtung: TechCooldown senkt die *Abklingzeitreduktion* – „−13 % Abklingzeit“ wäre ein Vorteil.
 */
const PENALTY_EFFECT_LABEL_DE: Record<string, string> = {
  MODIFIER_VALUE_COOLDOWN_REDUCTION_PERCENTAGE: 'Abklingzeitreduktion',
  MODIFIER_VALUE_TECH_RANGE_PERCENT: 'Fähigkeiten-Reichweite',
  MODIFIER_VALUE_TECH_RADIUS_PERCENT: 'Fähigkeiten-Radius',
  MODIFIER_VALUE_BONUS_ABILITY_DURATION_PERCENTAGE: 'Fähigkeiten-Dauer',
  MODIFIER_VALUE_TECH_POWER: 'Spirit-Kraft',
  MODIFIER_VALUE_TECH_RESIST_REDUCTION: 'Spirit-Resistenz',
  MODIFIER_VALUE_STAMINA: 'Ausdauer',
  MODIFIER_VALUE_STAMINA_REGEN_PER_SECOND_PERCENTAGE: 'Ausdauerregeneration',
  MODIFIER_VALUE_MOVEMENT_SPEED_MAX: 'Lauftempo',
  MODIFIER_VALUE_FIRE_RATE: 'Feuerrate',
  MODIFIER_VALUE_WEAPON_DAMAGE_INCREASE: 'Waffenschaden',
  MODIFIER_VALUE_HEALTH_MAX: 'Lebenspunkte',
  MODIFIER_VALUE_BULLET_AND_MELEE_RESIST_REDUCTION: 'Kugel- und Nahkampfresistenz',
}

/** Fallback nach Name des Nachteils, falls ein Effekt unbekannt ist */
const PENALTY_LABEL_DE: Record<string, string> = {
  TechCooldown: 'Abklingzeitreduktion',
  TechRange: 'Fähigkeiten-Reichweite',
  TechDuration: 'Fähigkeiten-Dauer',
  TechPower: 'Spirit-Kraft',
  TechResist: 'Spirit-Resistenz',
  Stamina: 'Ausdauer',
  MoveSpeed: 'Lauftempo',
  FireRate: 'Feuerrate',
  WeaponDamage: 'Waffenschaden',
  Health: 'Lebenspunkte',
  BulletResist: 'Kugelresistenz',
}

function toNumber(value: unknown): number | null {
  const n = Number.parseFloat(String(value ?? ''))
  return Number.isFinite(n) ? n : null
}

/** Rundet wie die Ingame-Tooltips: ab 20 ganze Zahlen, darunter höchstens 2 Nachkommastellen. */
export function roundForDisplay(n: number): number {
  const clean = Math.round(n * 1e4) / 1e4
  return Math.abs(clean) >= 20 ? Math.round(clean) : Math.round(clean * 100) / 100
}

/**
 * Broker-Variante: verbesserte Werte und mögliche Nachteile für das Tier des Items.
 * Nachteile fallen weg, wenn das Item sie ausschließt, sie im Tier keinen Wert haben
 * oder einen Wert betreffen, den das Item selbst liefert (wie im Spiel).
 */
export function buildCorrupted(
  item: ApiItem,
  info: ApiCorruptedInfo,
  tier: number,
  generic?: ApiGenericData,
): CorruptedInfo | undefined {
  const props = item.properties ?? {}
  const bonuses: CorruptedStat[] = []
  for (const upgrade of info.property_upgrades ?? []) {
    const prop = props[upgrade.name]
    const base = toNumber(prop?.value)
    const bonus = toNumber(upgrade.bonus)
    if (!prop || base === null || bonus === null) continue
    const raw = upgrade.round_corrupted_bonus ? Math.round(base + bonus) : base + bonus
    const stat: CorruptedStat = {
      label: prop.label?.trim() || humanizeKey(upgrade.name),
      base: formatPropertyValue(prop),
      value: formatPropertyValue({ ...prop, value: String(roundForDisplay(raw)) }),
      varies: !upgrade.fixed_corrupted_bonus,
    }
    // Manche Items haben zwei interne Werte mit gleicher Anzeige (z. B. 2× „Eingehende Heilung“)
    if (!bonuses.some(b => b.label === stat.label && b.base === stat.base && b.value === stat.value)) bonuses.push(stat)
  }

  const excluded = new Set(info.excluded_penalties ?? [])
  const provided = new Set(
    Object.values(props)
      .filter(p => p?.provided_property_type && toNumber(p.value))
      .map(p => p.provided_property_type as string),
  )
  const penalties: Stat[] = []
  for (const penalty of generic?.corrupted_penalties ?? []) {
    if (excluded.has(penalty.name)) continue
    if (penalty.effects.some(e => provided.has(e.modifier_value))) continue
    const effects = penalty.effects.filter(e => e.display !== false && (e.bonus_per_tier?.[tier] ?? 0) !== 0)
    if (!effects.length) continue
    const value = effects
      .map(e => {
        const v = roundForDisplay(e.bonus_per_tier[tier])
        return `${v > 0 ? '+' : ''}${v}${e.postfix ?? ''}`
      })
      .join(' / ')
    const label = effects
      .map(e => PENALTY_EFFECT_LABEL_DE[e.modifier_value]
        ?? (effects.length === 1 ? PENALTY_LABEL_DE[penalty.name] : undefined)
        ?? (e.label?.trim() || e.modifier_value))
      .join(' / ')
    penalties.push({ label, value, negative: true })
  }

  if (!bonuses.length && !penalties.length) return undefined
  const price = generic?.item_corruption_price_per_tier?.[tier]
  return { price: price && price > 0 ? price : undefined, bonuses, penalties }
}

function imageOf(item: ApiItem): string | undefined {
  return item.shop_image_webp || item.shop_image || item.image_webp || item.image || undefined
}

export function isLearnableItem(item: ApiItem): boolean {
  return item.type === 'upgrade'
    && item.shopable !== false
    && item.disabled !== true
    && !!item.item_slot_type
    && !!item.item_tier
    && !!item.name
}

/**
 * Baut die Item-Karten. Namen kommen aus der englischen Liste,
 * Beschreibungen/Stats aus der deutschen (Fallback: englisch).
 * `generic` liefert Broker-Nachteile und Corrupted-Preise (optional).
 */
export function buildItemCards(englishItems: ApiItem[], germanItems: ApiItem[], generic?: ApiGenericData): ItemCard[] {
  const germanById = new Map(germanItems.map(i => [i.id, i]))
  const learnable = englishItems.filter(isLearnableItem)
  const nameByClass = new Map(englishItems.map(i => [i.class_name, i.name]))
  const learnableClasses = new Set(learnable.map(i => i.class_name))

  const parents = new Map<string, string[]>()
  for (const item of learnable) {
    for (const comp of item.component_items ?? []) {
      const list = parents.get(comp) ?? []
      list.push(item.name)
      parents.set(comp, list)
    }
  }

  return learnable.map(en => {
    const text = germanById.get(en.id) ?? en
    const card: Omit<ItemCard, 'fingerprint'> = {
      id: `item:${en.class_name}`,
      className: en.class_name,
      name: en.name,
      slot: en.item_slot_type!,
      tier: en.item_tier!,
      cost: en.cost ?? 0,
      isActive: !!en.is_active_item,
      image: imageOf(en),
      timings: buildTimings(text),
      sections: buildSections(text),
      buildsFrom: (en.component_items ?? [])
        .filter(c => learnableClasses.has(c))
        .map(c => nameByClass.get(c)!)
        .filter(Boolean),
      upgradesTo: (parents.get(en.class_name) ?? []).sort(),
    }
    const corruptedInfo = en.corrupted_info ?? text.corrupted_info
    if (corruptedInfo) {
      const corrupted = buildCorrupted(text, corruptedInfo, en.item_tier!, generic)
      if (corrupted) card.corrupted = corrupted
    }
    // Fingerprint nur aus Spielwerten (englische Rohdaten) – siehe fingerprint.ts
    const fingerprint = makeFingerprint({
      cost: en.cost ?? 0,
      tier: en.item_tier,
      slot: en.item_slot_type,
      active: !!en.is_active_item,
      components: [...(en.component_items ?? [])].sort(),
      values: propertyValues(en.properties, isPropertyVisible),
      corrupted: bonusPairs(en.corrupted_info?.property_upgrades),
    })
    return { ...card, fingerprint }
  }).sort((a, b) => a.tier - b.tier || a.slot.localeCompare(b.slot) || a.name.localeCompare(b.name))
}
