// Teilmenge des Schemas von https://api.deadlock-api.com/v1/assets/items
// (abgeleitet aus den Typen von @deadlock-api/ui-core).

export type SlotType = 'weapon' | 'spirit' | 'vitality'

export interface ApiItemProperty {
  value: string | number | null
  disable_value?: string | null
  label?: string | null
  prefix?: string | null
  postfix?: string | null
  negative_attribute?: boolean | null
  conditional?: string | null
  /** Welchen Wert das Item liefert, z. B. MODIFIER_VALUE_FIRE_RATE (für Broker-Nachteile) */
  provided_property_type?: string | null
}

export interface ApiTooltipSectionAttribute {
  loc_string?: string | null
  properties?: string[] | null
  elevated_properties?: string[] | null
  important_properties?: string[] | null
}

export interface ApiTooltipSection {
  section_type: 'innate' | 'active' | 'passive' | null
  section_attributes: ApiTooltipSectionAttribute[]
}

export interface ApiItem {
  id: number
  class_name: string
  name: string
  type: string
  item_slot_type?: SlotType
  item_tier?: number
  cost?: number
  shopable?: boolean | null
  disabled?: boolean | null
  activation?: string
  is_active_item?: boolean
  image?: string | null
  image_webp?: string | null
  shop_image?: string | null
  shop_image_webp?: string | null
  description?: Record<string, string> | string | null
  properties?: Record<string, ApiItemProperty> | null
  tooltip_sections?: ApiTooltipSection[] | null
  component_items?: string[] | null
  corrupted_info?: ApiCorruptedInfo | null
  // --- nur bei Abilities (type: 'ability') ---
  hero?: number | null
  heroes?: number[] | null
  /** 'signature' | 'ultimate' | … */
  ability_type?: string | null
  tooltip_details?: { info_sections?: ApiInfoSection[] | null } | null
  /** Ability-Upgrades (Stufe 1–3) */
  upgrades?: { property_upgrades?: { name: string; bonus: string | number }[] | null }[] | null
  // --- nur bei Waffen (type: 'weapon') ---
  weapon_info?: Record<string, unknown> | null
}

export interface ApiInfoSection {
  loc_string?: string | null
  properties_block?: { properties?: { important_property?: string | null }[] | null }[] | null
  basic_properties?: string[] | null
}

/** Startwerte sind Zahlen oder { value, display_stat_name } */
export type ApiStatValue = number | string | { value?: number | string | null } | null

/** Teilmenge von /v1/assets/heroes */
export interface ApiHero {
  id: number
  class_name: string
  name: string
  description?: { lore?: string | null; role?: string | null; playstyle?: string | null } | null
  player_selectable?: boolean | null
  disabled?: boolean | null
  in_development?: boolean | null
  tags?: string[] | null
  gun_tag?: string | null
  complexity?: number | null
  images?: Record<string, string | null | undefined> | null
  colors?: { style_hex?: string | null } | null
  /** Slot → Ability/Waffe, z. B. signature1 → "ability_sleep_dagger" (ältere Daten: Item-ID) */
  items?: Record<string, string | number | null> | null
  starting_stats?: Record<string, ApiStatValue> | null
}

/** Broker-Variante eines Tier-3/4-Items */
export interface ApiCorruptedInfo {
  property_upgrades: {
    name: string
    bonus: string | number
    /** Bonus schwankt nicht pro Match */
    fixed_corrupted_bonus?: boolean | null
    /** Ergebnis wird auf ganze Zahl gerundet */
    round_corrupted_bonus?: boolean | null
  }[]
  excluded_penalties: string[]
}

export interface ApiPenaltyEffect {
  modifier_value: string
  /** Wert je Tier (Index 3 = T3, 4 = T4) */
  bonus_per_tier: number[]
  display: boolean
  label?: string | null
  postfix?: string | null
}

export interface ApiPenalty {
  name: string
  roll_weight?: number | null
  effects: ApiPenaltyEffect[]
}

/** Teilmenge von /v1/assets/generic-data */
export interface ApiGenericData {
  item_price_per_tier?: number[]
  item_corruption_price_per_tier?: number[]
  corrupted_penalties?: ApiPenalty[]
}
