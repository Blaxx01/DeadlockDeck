import { describe, expect, it } from 'vitest'
import type { ItemCard, SlotType } from '../data/model'
import { normalizeText, searchItems, shopTiers } from './search'

function card(name: string, slot: SlotType, tier: number, text = '', cost = [0, 800, 1600, 3200, 6400][tier]): ItemCard {
  return {
    id: `item:${name}`, className: name, name, slot, tier, cost, isActive: false, timings: [], buildsFrom: [], upgradesTo: [], fingerprint: '',
    sections: text ? [{ type: 'passive', html: text, stats: [{ label: 'Lebensraub', value: '+10%' }] }] : [],
  }
}

const CARDS = [
  card('Rescue Beam', 'vitality', 2, 'Zieht einen <b>Verbündeten</b> zu dir und heilt ihn.'),
  card('Healing Rite', 'vitality', 1, 'Heilt ein Ziel über Zeit.'),
  card('Headshot Booster', 'weapon', 1),
  card('Mystic Burst', 'spirit', 1, 'Fähigkeiten mit hohem Schaden lösen Spirit-Schaden aus.'),
  card('Healbane', 'spirit', 2, 'Senkt die Heilung von Gegnern.'),
]

describe('Shop-Suche', () => {
  it('findet Namen ohne Rücksicht auf Groß-/Kleinschreibung', () => {
    expect(searchItems(CARDS, 'headshot').map(c => c.name)).toEqual(['Headshot Booster'])
  })

  it('durchsucht deutsche Effekttexte und Stat-Namen, Umlaute optional', () => {
    expect(searchItems(CARDS, 'fahigkeiten').map(c => c.name)).toEqual(['Mystic Burst'])
    expect(searchItems(CARDS, 'Verbündeten').map(c => c.name)).toEqual(['Rescue Beam'])
    expect(searchItems(CARDS, 'lebensraub')).toHaveLength(4)
  })

  it('verlangt alle Wörter und zeigt Namenstreffer zuerst', () => {
    expect(searchItems(CARDS, 'heil ziel').map(c => c.name)).toEqual(['Healing Rite'])
    // "heal" steht nur in Namen → Namenstreffer, dann Kategorie/Tier
    expect(searchItems(CARDS, 'heal').map(c => c.name)).toEqual(['Healing Rite', 'Healbane'])
    // "heil" steckt in Texten von drei Items
    expect(searchItems(CARDS, 'heil').map(c => c.name)).toEqual(['Healing Rite', 'Rescue Beam', 'Healbane'])
  })

  it('ignoriert HTML-Tags und leere Suchen', () => {
    // Rescue Beam enthält <b>Verbündeten</b> – die Tags selbst dürfen nicht durchsucht werden
    expect(searchItems(CARDS, '<b>')).toEqual([])
    expect(searchItems(CARDS, 'verbundeten').map(c => c.name)).toEqual(['Rescue Beam'])
    expect(searchItems(CARDS, '   ')).toEqual([])
    expect(normalizeText('Fähigkeit ÄÖÜ')).toBe('fahigkeit aou')
  })
})

describe('Shop-Aufbau', () => {
  it('gruppiert eine Kategorie nach Tier, alphabetisch, mit Tier-Preis', () => {
    const cards = [
      card('Zeta', 'weapon', 1), card('Alpha', 'weapon', 1), card('Beta', 'weapon', 3),
      card('Gamma', 'vitality', 1), card('Odd', 'weapon', 3, '', 3000), card('Delta', 'weapon', 3),
    ]
    expect(shopTiers(cards, 'weapon')).toEqual([
      { tier: 1, price: 800, items: [cards[1], cards[0]] },
      { tier: 3, price: 3200, items: [cards[2], cards[5], cards[4]] },
    ])
  })
})
