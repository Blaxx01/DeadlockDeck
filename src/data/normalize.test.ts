import { describe, expect, it } from 'vitest'
import { englishItems, germanItems } from '../test/fixtures'
import { buildItemCards, formatPropertyValue, isPropertyVisible } from './normalize'

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
      { label: 'Abklingzeit', value: '60s' },
      { label: 'Duration', value: '17s' },
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
