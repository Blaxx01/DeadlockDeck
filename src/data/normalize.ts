import type { ApiItem, ApiItemProperty, ApiTooltipSection } from './apiTypes'
import type { CardSection, ItemCard, SectionType, Stat, Timing, TimingKind } from './model'

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
  const value = String(prop.value ?? '')
  const num = Number.parseFloat(value)
  const sign = Number.isFinite(num) && num >= 0 ? '+' : ''
  const prefix = prop.prefix?.replace('{s:sign}', sign) ?? ''
  const postfix = prop.postfix ?? ''
  const suffix = postfix.trim() && value.endsWith(postfix.trim()) ? '' : postfix
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

function imageOf(item: ApiItem): string | undefined {
  return item.shop_image_webp || item.shop_image || item.image_webp || item.image || undefined
}

/** FNV-1a – reicht, um Inhaltsänderungen zwischen Patches zu erkennen. */
export function hashString(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
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
 */
export function buildItemCards(englishItems: ApiItem[], germanItems: ApiItem[]): ItemCard[] {
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
    const card: Omit<ItemCard, 'hash'> = {
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
    const { image: _image, ...content } = card
    return { ...card, hash: hashString(JSON.stringify(content)) }
  }).sort((a, b) => a.tier - b.tier || a.slot.localeCompare(b.slot) || a.name.localeCompare(b.name))
}
