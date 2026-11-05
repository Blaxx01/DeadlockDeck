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
}
