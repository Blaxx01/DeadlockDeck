import { describe, expect, it } from 'vitest'
import type { ApiHero, ApiItem } from './apiTypes'
import { buildHeroDecks, cleanHtml } from './heroes'

// Testdaten in der Struktur von /v1/assets/heroes und /items (Inhalte erfunden)
function hero(id: number, name: string, extra: Partial<ApiHero> = {}): ApiHero {
  const slug = name.toLowerCase()
  return {
    id, class_name: `hero_${slug}`, name, player_selectable: true, disabled: false, in_development: false,
    complexity: 2, tags: ['Brawler'], gun_tag: 'Rapid Fire', colors: { style_hex: '#123456' },
    images: {
      icon_hero_card_webp: `https://cdn/${slug}_card.webp`, icon_image_small_webp: `https://cdn/${slug}_sm.webp`,
      hero_card_critical: `https://cdn/${slug}_critical.png`, hero_card_gloat_webp: `https://cdn/${slug}_gloat.webp`,
    },
    items: {
      weapon_primary: `weapon_${slug}`,
      signature1: `ability_${slug}_1`, signature2: `ability_${slug}_2`, signature3: `ability_${slug}_3`, signature4: `ability_${slug}_4`,
    },
    starting_stats: { max_health: { value: 700 }, max_move_speed: { value: 8.2 }, sprint_speed: 1.5, stamina: { value: 3 }, light_melee_damage: { value: 0 } },
    ...extra,
  }
}

function ability(slug: string, slot: number, lang: 'en' | 'de', extra: Partial<ApiItem> = {}): ApiItem {
  return {
    id: 1000 + slot, class_name: `ability_${slug}_${slot}`, name: lang === 'en' ? `${slug} Ability ${slot}` : `${slug} Fähigkeit ${slot}`,
    type: 'ability', ability_type: slot === 4 ? 'ultimate' : 'signature', image_webp: `https://cdn/${slug}_${slot}.webp`,
    description: { desc: lang === 'de' ? `Effekt ${slot} <svg viewBox="0 0 1 1"><path d="M0"/></svg>auf Deutsch.` : `Effect ${slot}`, quip: lang === 'de' ? `Kurz ${slot}` : `Short ${slot}`, t1_desc: '+1 Ladung', t2_desc: '+10 % Schaden', t3_desc: '-5 s Abklingzeit' },
    properties: {
      AbilityCooldown: { value: 30, label: lang === 'de' ? 'Abklingzeit' : 'Cooldown', postfix: ' s', disable_value: '0' },
      AbilityCharges: { value: '0', disable_value: '-1', label: 'Aufladungen' },
      AbilityDuration: { value: '0', disable_value: '0', label: 'Dauer', postfix: ' s' },
      Damage: { value: 65, label: 'Schaden' },
      SlowPercent: { value: '40', label: 'Verlangsamung', postfix: ' %' },
      Hidden: { value: '0', label: 'Unsichtbar' },
      NoLabel: { value: '5' },
    },
    tooltip_details: { info_sections: [{
      loc_string: 'Abschnittstext',
      properties_block: [{ properties: [{ important_property: 'StatusEffectSleep' }, { important_property: 'Damage' }, { important_property: 'AbilityCooldown' }] }],
      basic_properties: ['SlowPercent', 'Hidden', 'NoLabel', 'Damage'],
    }] },
    upgrades: [
      { property_upgrades: [{ name: 'AbilityCharges', bonus: 1 }] },
      { property_upgrades: [{ name: 'Damage', bonus: 10 }] },
      { property_upgrades: [{ name: 'AbilityCooldown', bonus: -5 }] },
    ],
    ...extra,
  }
}

const weapon = (slug: string): ApiItem => ({
  id: 2000, class_name: `weapon_${slug}`, name: `${slug} Gun`, type: 'weapon',
  weapon_info: { bullet_damage: 5.263, bullets: 4, clip_size: 25, reload_duration: 2.35 },
})

const heroesEn = [hero(2, 'Zeta'), hero(1, 'Alpha'), hero(3, 'Hidden', { player_selectable: false }), hero(4, 'Broken', { disabled: true })]
const heroesDe = heroesEn.map(h => ({ ...h, name: `${h.name} (DE)`, tags: ['Schläger', 'Robust'], gun_tag: 'Schnellfeuer', description: { role: 'Rolle auf Deutsch', playstyle: 'Spielstil<br>zweite Zeile' } }))
const itemsEn = ['alpha', 'zeta'].flatMap(s => [1, 2, 3, 4].map(n => ability(s, n, 'en'))).concat(weapon('alpha'), weapon('zeta'))
const itemsDe = ['alpha', 'zeta'].flatMap(s => [1, 2, 3, 4].map(n => ability(s, n, 'de'))).concat(weapon('alpha'), weapon('zeta'))

describe('buildHeroDecks', () => {
  const { heroes, abilities } = buildHeroDecks(heroesEn, heroesDe, itemsEn, itemsDe)
  const alpha = heroes[0]
  const a1 = abilities.find(a => a.className === 'ability_alpha_1')!

  it('nimmt nur spielbare Heroes, alphabetisch, mit englischem Namen', () => {
    expect(heroes.map(h => h.name)).toEqual(['Alpha', 'Zeta'])
    expect(heroes.map(h => h.order)).toEqual([0, 1])
    expect(alpha.id).toBe('hero:hero_alpha')
  })

  it('übernimmt deutsche Texte, Tags, Waffentyp und Farbe', () => {
    expect(alpha).toMatchObject({
      role: 'Rolle auf Deutsch', playstyle: 'Spielstil<br>zweite Zeile', tags: ['Schläger', 'Robust'],
      gunTag: 'Schnellfeuer', color: '#123456', complexity: 2, image: 'https://cdn/alpha_card.webp',
    })
    // webp bevorzugt, sonst png
    expect(alpha.poses).toEqual(['https://cdn/alpha_card.webp', 'https://cdn/alpha_critical.png', 'https://cdn/alpha_gloat.webp'])
  })

  it('liest Startwerte als Zahl oder Objekt und lässt 0 weg', () => {
    expect(alpha.stats).toEqual([
      { label: 'Leben', value: '700' },
      { label: 'Lauftempo', value: '8.2 m/s' },
      { label: 'Sprinttempo', value: '+1.5 m/s' },
      { label: 'Ausdauer', value: '3' },
    ])
  })

  it('zeigt die Waffe mit englischem Namen', () => {
    expect(alpha.weapon).toEqual({ name: 'alpha Gun', stats: [
      { label: 'Kugelschaden', value: '5.26 × 4' }, { label: 'Magazin', value: '25' }, { label: 'Nachladen', value: '2.35 s' },
    ] })
  })

  it('ordnet die vier Abilities über signature1–4 zu, Slot 4 = Ultimate', () => {
    expect(alpha.abilities.map(a => [a.name, a.slot])).toEqual([
      ['alpha Ability 1', 1], ['alpha Ability 2', 2], ['alpha Ability 3', 3], ['alpha Ability 4', 4],
    ])
    expect(abilities).toHaveLength(8)
    expect(a1).toMatchObject({ heroName: 'Alpha', heroId: 1, slot: 1, order: 1, heroColor: '#123456', heroImage: 'https://cdn/alpha_sm.webp' })
  })

  it('Ability: englischer Name, deutscher Text ohne SVG, Kurzsatz', () => {
    expect(a1.name).toBe('alpha Ability 1')
    expect(a1.html).toBe('Effekt 1 auf Deutsch.')
    expect(a1.quip).toBe('Kurz 1')
  })

  it('Ability: Zeiten ohne 0-Werte und ohne „0 Aufladungen“', () => {
    expect(a1.timings).toEqual([{ label: 'Abklingzeit', value: '30 s', kind: 'cooldown' }])
    const charged = buildHeroDecks(heroesEn, heroesDe, itemsEn, itemsDe.map(i => (i.class_name === 'ability_alpha_1'
      ? { ...i, properties: { ...i.properties, AbilityCharges: { value: '3', disable_value: '-1', label: 'Aufladungen' } } }
      : i))).abilities.find(a => a.className === 'ability_alpha_1')!
    expect(charged.timings.map(t => t.kind)).toEqual(['cooldown', 'charges'])
  })

  it('Ability: Werte aus den Tooltip-Abschnitten ohne Zeiten, Status und Unsichtbares', () => {
    expect(a1.stats).toEqual([{ label: 'Schaden', value: '65' }, { label: 'Verlangsamung', value: '40 %' }])
  })

  it('Ability: Upgrades mit 1/2/5 AP, sonst aus den Werten gebaut', () => {
    expect(a1.upgrades).toEqual([
      { cost: 1, html: '+1 Ladung' }, { cost: 2, html: '+10 % Schaden' }, { cost: 5, html: '-5 s Abklingzeit' },
    ])
    const noText = itemsDe.map(i => (i.class_name === 'ability_alpha_1' ? { ...i, description: { desc: 'x' } } : i))
    const built = buildHeroDecks(heroesEn, heroesDe, itemsEn, noText).abilities.find(a => a.className === 'ability_alpha_1')!
    expect(built.upgrades).toEqual([
      { cost: 1, html: '<span class="highlight">+1</span> Aufladungen' },
      { cost: 2, html: '<span class="highlight">+10</span> Schaden' },
      { cost: 5, html: '<span class="highlight">-5 s</span> Abklingzeit' },
    ])
  })

  it('Ability ohne desc nutzt die Tooltip-Abschnitte', () => {
    const items = itemsDe.map(i => (i.class_name === 'ability_alpha_2' ? { ...i, description: {} } : i))
    expect(buildHeroDecks(heroesEn, heroesDe, itemsEn, items).abilities.find(a => a.className === 'ability_alpha_2')!.html).toBe('Abschnittstext')
  })

  it('löst auch ältere Daten mit Item-IDs statt Klassennamen auf', () => {
    const numeric = [hero(1, 'Alpha', { items: { signature1: 1001, signature2: 1002, signature3: 1003, signature4: 1004 } })]
    const { heroes: hs } = buildHeroDecks(numeric, [], itemsEn.filter(i => i.class_name.startsWith('ability_alpha')), [])
    expect(hs[0].abilities.map(a => a.slot)).toEqual([1, 2, 3, 4])
  })

  it('erzeugt stabile Hashes', () => {
    const again = buildHeroDecks(heroesEn, heroesDe, itemsEn, itemsDe)
    expect(again.abilities.map(a => a.hash)).toEqual(abilities.map(a => a.hash))
    expect(again.heroes.map(h => h.hash)).toEqual(heroes.map(h => h.hash))
  })
})

describe('cleanHtml', () => {
  it('entfernt SVG-Icons und leere Texte', () => {
    expect(cleanHtml('a<svg width="1"><path d="x"/></svg>b')).toBe('ab')
    expect(cleanHtml('<svg></svg>')).toBeUndefined()
    expect(cleanHtml(null)).toBeUndefined()
  })
})
