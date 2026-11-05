// Testdaten im Format der Deadlock-API. Werte sind NICHT aktuell/korrekt – nur für Tests.
import type { ApiItem } from '../data/apiTypes'

export const englishItems: ApiItem[] = [
  {
    id: 1, class_name: 'upgrade_clip_size', name: 'Basic Magazine', type: 'upgrade',
    item_slot_type: 'weapon', item_tier: 1, cost: 800, shopable: true, is_active_item: false,
    shop_image_webp: 'https://assets-bucket.deadlock-api.com/x/basic_mag.webp',
    properties: {
      BonusClipSizePercent: { value: '22', label: 'Ammo', prefix: '{s:sign}', postfix: '%' },
      WeaponPower: { value: '6', label: 'Weapon Damage', prefix: '{s:sign}', postfix: '%' },
    },
    tooltip_sections: [{ section_type: 'innate', section_attributes: [{ properties: ['BonusClipSizePercent', 'WeaponPower'] }] }],
  },
  {
    id: 2, class_name: 'upgrade_titanic_magazine', name: 'Titanic Magazine', type: 'upgrade',
    item_slot_type: 'weapon', item_tier: 3, cost: 3200, shopable: true,
    shop_image: 'https://assets-bucket.deadlock-api.com/x/titanic.png',
    component_items: ['upgrade_clip_size'],
    properties: { BonusClipSizePercent: { value: '100', label: 'Ammo', prefix: '{s:sign}', postfix: '%' } },
    tooltip_sections: [{ section_type: 'innate', section_attributes: [{ properties: ['BonusClipSizePercent'] }] }],
  },
  {
    id: 3, class_name: 'upgrade_healing_rite', name: 'Healing Rite', type: 'upgrade',
    item_slot_type: 'vitality', item_tier: 1, cost: 800, shopable: true, is_active_item: true,
    properties: {
      AbilityCooldown: { value: '60', label: 'Cooldown', postfix: 's' },
      AbilityDuration: { value: '17', label: 'Duration', postfix: 's' },
      AbilityCastRange: { value: '0', label: 'Cast Range', postfix: 'm' },
      HealthRegen: { value: '300', label: 'Total Heal' },
      MoveSpeed: { value: '-1', label: 'Move Speed', postfix: 'm/s', negative_attribute: true },
    },
    tooltip_sections: [{
      section_type: 'active',
      section_attributes: [{
        loc_string: 'Heal a target. Press {g:citadel_binding:\'Reload\'}.',
        important_properties: ['HealthRegen'],
        properties: ['AbilityCooldown', 'MoveSpeed'],
      }],
    }],
  },
  { id: 4, class_name: 'upgrade_old', name: 'Removed Item', type: 'upgrade', item_slot_type: 'spirit', item_tier: 2, cost: 1600, disabled: true },
  { id: 5, class_name: 'ability_fireball', name: 'Fireball', type: 'ability' },
  { id: 6, class_name: 'upgrade_not_shop', name: 'Hidden', type: 'upgrade', item_slot_type: 'spirit', item_tier: 1, shopable: false },
]

export const germanItems: ApiItem[] = [
  {
    ...englishItems[0], name: 'Einfaches Magazin',
    properties: {
      BonusClipSizePercent: { value: '22', label: 'Munition', prefix: '{s:sign}', postfix: '%' },
      WeaponPower: { value: '6', label: 'Waffenschaden', prefix: '{s:sign}', postfix: '%' },
    },
  },
  {
    ...englishItems[2], name: 'Heilritus',
    properties: {
      ...englishItems[2].properties,
      AbilityCooldown: { value: '60', label: 'Abklingzeit', postfix: 's' },
      HealthRegen: { value: '300', label: 'Gesamtheilung' },
    },
    tooltip_sections: [{
      section_type: 'active',
      section_attributes: [{
        loc_string: 'Heilt ein Ziel. Drücke {g:citadel_binding:\'Reload\'}. <img src=x onerror="alert(1)">',
        important_properties: ['HealthRegen'],
        properties: ['AbilityCooldown', 'MoveSpeed'],
      }],
    }],
  },
]
