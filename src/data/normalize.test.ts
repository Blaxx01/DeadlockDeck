import { describe, expect, it } from 'vitest'
import { englishItems, germanItems } from '../test/fixtures'
import type { ApiGenericData, ApiItem } from './apiTypes'
import { buildItemCards, formatPropertyValue, isPropertyVisible, roundForDisplay } from './normalize'

describe('buildItemCards', () => {
  const cards = buildItemCards(englishItems, germanItems)
  const byClass = new Map(cards.map(c => [c.className, c]))

  it('nimmt nur kaufbare, aktive Upgrades', () => {
    expect(cards.map(c => c.className).sort()).toEqual(
      ['upgrade_clip_size', 'upgrade_healing_rite', 'upgrade_titanic_magazine'],
    )
  })

  it('verwendet englische Namen und deutsche Stats', () => {
    const mag = byClass.get('upgrade_clip_size')!
    expect(mag.name).toBe('Basic Magazine')
    expect(mag.sections[0].stats).toEqual([
      { label: 'Munition', value: '+22%' },
      { label: 'Waffenschaden', value: '+6%' },
    ])
  })

  it('fällt auf englische Texte zurück, wenn es keine deutschen gibt', () => {
    const titanic = byClass.get('upgrade_titanic_magazine')!
    expect(titanic.sections[0].stats[0]).toEqual({ label: 'Ammo', value: '+100%' })
  })

  it('zieht Cooldown/Dauer nach oben und blendet 0-Werte aus', () => {
    const rite = byClass.get('upgrade_healing_rite')!
    expect(rite.timings).toEqual([
      { label: 'Abklingzeit', value: '60s', kind: 'cooldown' },
      { label: 'Duration', value: '17s', kind: 'duration' },
    ])
    expect(rite.sections[0].stats.map(s => s.label)).toEqual(['Gesamtheilung', 'Move Speed'])
    expect(rite.sections[0].stats[1].negative).toBe(true)
    expect(rite.sections[0].html).toContain('<span class="key">Reload</span>')
    expect(rite.isActive).toBe(true)
  })

  it('berechnet den Build-Pfad in beide Richtungen', () => {
    expect(byClass.get('upgrade_titanic_magazine')!.buildsFrom).toEqual(['Basic Magazine'])
    expect(byClass.get('upgrade_clip_size')!.upgradesTo).toEqual(['Titanic Magazine'])
  })

  it('bevorzugt das Shop-Bild als webp', () => {
    expect(byClass.get('upgrade_clip_size')!.image).toMatch(/basic_mag\.webp$/)
    expect(byClass.get('upgrade_healing_rite')!.image).toBeUndefined()
  })

  it('erzeugt stabile Hashes, die sich bei Inhaltsänderung ändern', () => {
    const again = buildItemCards(englishItems, germanItems)
    expect(again.map(c => c.hash)).toEqual(cards.map(c => c.hash))
    const patched = structuredClone(englishItems)
    patched[1].properties!.BonusClipSizePercent.value = '90'
    const changed = buildItemCards(patched, germanItems).find(c => c.className === 'upgrade_titanic_magazine')!
    expect(changed.hash).not.toBe(byClass.get('upgrade_titanic_magazine')!.hash)
  })

  it('sortiert nach Tier', () => {
    expect(cards.map(c => c.tier)).toEqual([...cards.map(c => c.tier)].sort())
  })
})

describe('Property-Helfer', () => {
  it('formatiert Vorzeichen und Einheit', () => {
    expect(formatPropertyValue({ value: '-5', prefix: '{s:sign}', postfix: '%' })).toBe('-5%')
    expect(formatPropertyValue({ value: '12m', postfix: 'm' })).toBe('12m')
  })
  it('respektiert disable_value', () => {
    expect(isPropertyVisible({ value: '1', disable_value: '1' })).toBe(false)
    expect(isPropertyVisible({ value: '0' })).toBe(false)
    expect(isPropertyVisible({ value: 3 })).toBe(true)
  })
})

describe('Broker-Variante', () => {
  const generic: ApiGenericData = {
    item_corruption_price_per_tier: [0, 0, 0, 4800, 9600],
    corrupted_penalties: [
      { name: 'FireRate', effects: [{ modifier_value: 'MODIFIER_VALUE_FIRE_RATE', bonus_per_tier: [0, 0, 0, -8, -12], display: true, label: 'Fire Rate', postfix: '%' }] },
      { name: 'Health', effects: [{ modifier_value: 'MODIFIER_VALUE_HEALTH_MAX', bonus_per_tier: [0, 0, 0, -75, -150], display: true, label: 'Max Health' }] },
      { name: 'TechRange', effects: [{ modifier_value: 'MODIFIER_VALUE_TECH_RANGE', bonus_per_tier: [0, 0, 0, 0, -9], display: true, label: 'Spirit Range', postfix: '%' }] },
      { name: 'MoveSpeed', effects: [{ modifier_value: 'MODIFIER_VALUE_MOVE_SPEED', bonus_per_tier: [0, 0, 0, -0.5, -0.75], display: true, label: 'Move Speed', postfix: 'm/s' }] },
      { name: 'Hidden', effects: [{ modifier_value: 'X', bonus_per_tier: [0, 0, 0, 5, 5], display: false }] },
    ],
  }
  const titanic: ApiItem = {
    id: 9, class_name: 'upgrade_titanic', name: 'Titanic Magazine', type: 'upgrade', item_slot_type: 'weapon',
    item_tier: 3, cost: 3200, shopable: true,
    properties: {
      BonusClipSizePercent: { value: '100', label: 'Munition', prefix: '{s:sign}', postfix: '%' },
      BonusFireRate: { value: '12.5', label: 'Feuerrate', prefix: '{s:sign}', postfix: '%', provided_property_type: 'MODIFIER_VALUE_FIRE_RATE' },
      Range: { value: '30', label: 'Reichweite', postfix: 'm' },
    },
    tooltip_sections: [{ section_type: 'innate', section_attributes: [{ properties: ['BonusClipSizePercent', 'BonusFireRate'] }] }],
    corrupted_info: {
      property_upgrades: [
        { name: 'BonusClipSizePercent', bonus: 30 },
        { name: 'BonusFireRate', bonus: '2.25', fixed_corrupted_bonus: true },
        { name: 'Range', bonus: 3.6, round_corrupted_bonus: true },
        { name: 'Missing', bonus: 5 },
      ],
      excluded_penalties: ['Health'],
    },
  }

  it('berechnet Boni, Preis und mögliche Nachteile', () => {
    const [card] = buildItemCards([titanic], [titanic], generic)
    expect(card.corrupted).toEqual({
      price: 4800,
      bonuses: [
        { label: 'Munition', base: '+100%', value: '+130%', varies: true },
        { label: 'Feuerrate', base: '+12.5%', value: '+14.75%', varies: false },
        { label: 'Reichweite', base: '30m', value: '34m', varies: true },
      ],
      // FireRate: liefert das Item selbst · Health: ausgeschlossen · TechRange: T3 = 0 · Hidden: nicht angezeigt
      penalties: [{ label: 'Lauftempo', value: '-0.5m/s', negative: true }],
    })
  })

  it('funktioniert ohne generic-data (dann nur Boni)', () => {
    const [card] = buildItemCards([titanic], [titanic])
    expect(card.corrupted?.price).toBeUndefined()
    expect(card.corrupted?.penalties).toEqual([])
    expect(card.corrupted?.bonuses).toHaveLength(3)
  })

  it('Items ohne Broker-Daten bekommen keine Broker-Variante', () => {
    expect(buildItemCards(englishItems, germanItems, generic).every(c => c.corrupted === undefined)).toBe(true)
  })

  it('roundForDisplay rundet wie ingame', () => {
    expect(roundForDisplay(17.349999999)).toBe(17.35)
    expect(roundForDisplay(23.6)).toBe(24)
    expect(roundForDisplay(-11.954)).toBe(-11.95)
  })
})

describe('Einheiten aus echten API-Daten', () => {
  it('nutzt nur die Einheit aus postfix, auch wenn der Wert schon eine hat', () => {
    expect(formatPropertyValue({ value: '2m', postfix: ' m/s', prefix: '{s:sign}' })).toBe('+2 m/s')
    expect(formatPropertyValue({ value: '30m', postfix: ' m' })).toBe('30 m')
    expect(formatPropertyValue({ value: 35, postfix: ' m' })).toBe('35 m')
    expect(formatPropertyValue({ value: '1.95', postfix: ' % Schaden pro Sek.' })).toBe('1.95 % Schaden pro Sek.')
    expect(formatPropertyValue({ value: '7.5s' })).toBe('7.5s')
  })
})

describe('Broker mit echter Datenstruktur', () => {
  const item: ApiItem = {
    id: 1, class_name: 'upgrade_decay', name: 'Decay', type: 'upgrade', item_slot_type: 'spirit', item_tier: 3, cost: 3200,
    properties: {
      HealAmpReceivePenaltyPercent: { value: '-55', label: 'Eingehende Heilung', postfix: ' %' },
      HealAmpRegenPenaltyPercent: { value: '-55', label: 'Eingehende Heilung', postfix: ' %' },
    },
    corrupted_info: {
      property_upgrades: [{ name: 'HealAmpReceivePenaltyPercent', bonus: -25 }, { name: 'HealAmpRegenPenaltyPercent', bonus: -25 }],
      excluded_penalties: [],
    },
  }
  const generic: ApiGenericData = {
    item_corruption_price_per_tier: [0, 0, 0, 0, 0, 0],
    corrupted_penalties: [
      { name: 'TechCooldown', effects: [{ modifier_value: 'MODIFIER_VALUE_COOLDOWN_REDUCTION_PERCENTAGE', label: 'Ability Cooldown Reduction', postfix: '%', bonus_per_tier: [0, 0, 0, -13, -17, 0], display: true }] },
      { name: 'Stamina', effects: [
        { modifier_value: 'MODIFIER_VALUE_STAMINA', label: 'Stamina', postfix: null, bonus_per_tier: [0, 0, 0, -1, -1, 0], display: true },
        { modifier_value: 'MODIFIER_VALUE_STAMINA_REGEN_PER_SECOND_PERCENTAGE', label: 'Stamina Regen', postfix: '%', bonus_per_tier: [0, 0, 0, -18, -24, 0], display: true },
      ] },
      { name: 'Future', effects: [{ modifier_value: 'MODIFIER_VALUE_NEW', label: 'Something New', postfix: '%', bonus_per_tier: [0, 0, 0, -5, -5, 0], display: true }] },
    ],
  }
  const [card] = buildItemCards([item], [item], generic)

  it('zeigt doppelte Werte nur einmal und keinen Preis von 0', () => {
    expect(card.corrupted?.bonuses).toEqual([{ label: 'Eingehende Heilung', base: '-55 %', value: '-80 %', varies: true }])
    expect(card.corrupted?.price).toBeUndefined()
  })

  it('übersetzt jeden Effekt einzeln – Abklingzeitreduktion statt Abklingzeit', () => {
    expect(card.corrupted?.penalties).toEqual([
      { label: 'Abklingzeitreduktion', value: '-13%', negative: true },
      { label: 'Ausdauer / Ausdauerregeneration', value: '-1 / -18%', negative: true },
      { label: 'Something New', value: '-5%', negative: true },
    ])
  })
})
