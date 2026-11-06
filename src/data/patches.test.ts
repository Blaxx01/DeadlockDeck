import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { State } from 'ts-fsrs'
import { englishItems, germanItems } from '../test/fixtures'
import type { ApiItem } from './apiTypes'
import { DeckDB, getMeta, type LastPatch } from './db'
import { makeFingerprint, normValue, sameFingerprintVersion } from './fingerprint'
import { buildItemCards } from './normalize'
import {
  ADDED_PRIORITY, cardLabel, detectChanges, detectRemoved, diffValues, displayedValues, isRecentPatch, newCardOrder,
  showPatchNote, showPatchOnCard, type PatchRecord,
} from './patches'
import { buildQueue } from '../srs/srs'
import { assertPlausible } from './sync'
import { syncItems } from './sync'
import { rateCard } from '../srs/srs'

const clone = <T,>(x: T): T => structuredClone(x)
const cardsOf = (en: ApiItem[], de: ApiItem[] = germanItems) => buildItemCards(en, de)
const byClass = (cards: ReturnType<typeof cardsOf>, c: string) => cards.find(x => x.className === c)!

describe('Fingerprint', () => {
  it('vereinheitlicht Zahlen und ignoriert Einheiten am Wert', () => {
    expect(normValue('30.0')).toBe('30')
    expect(normValue(30)).toBe('30')
    expect(normValue('2m')).toBe('2')
    expect(normValue('-0.50')).toBe('-0.5')
    expect(normValue('abc')).toBe('abc')
  })

  it('trägt eine Version', () => {
    expect(sameFingerprintVersion(makeFingerprint(1), makeFingerprint(2))).toBe(true)
    expect(sameFingerprintVersion('v0:abc', makeFingerprint(1))).toBe(false)
    expect(sameFingerprintVersion(undefined, makeFingerprint(1))).toBe(false)
  })

  it('bleibt gleich bei Übersetzung, Texten, Labels, Bildern und Zahlformat', () => {
    const base = byClass(cardsOf(englishItems), 'upgrade_healing_rite').fingerprint
    const en = clone(englishItems)
    const rite = en[2]
    rite.shop_image_webp = 'https://cdn/new.webp'
    rite.properties!.AbilityCooldown.label = 'Neues Label'
    rite.properties!.AbilityCooldown.value = '60.0'
    rite.tooltip_sections![0].section_attributes[0].loc_string = 'Ganz neuer Text'
    expect(byClass(cardsOf(en, []), 'upgrade_healing_rite').fingerprint).toBe(base)
  })

  it('ändert sich bei Spielwerten: Wert, Kosten, Bauteile, neuer Wert, Broker', () => {
    const base = cardsOf(englishItems)
    const variants: [string, (en: ApiItem[]) => void][] = [
      ['upgrade_healing_rite', en => { en[2].properties!.AbilityCooldown.value = 55 }],
      ['upgrade_healing_rite', en => { en[2].cost = 900 }],
      ['upgrade_titanic_magazine', en => { en[1].component_items = [] }],
      ['upgrade_clip_size', en => { en[0].properties!.NewStat = { value: 5, label: 'Neu' } }],
      ['upgrade_titanic_magazine', en => { en[1].corrupted_info = { property_upgrades: [{ name: 'X', bonus: 3 }], excluded_penalties: [] } }],
    ]
    for (const [cls, change] of variants) {
      const en = clone(englishItems)
      change(en)
      expect(byClass(cardsOf(en), cls).fingerprint, cls).not.toBe(byClass(base, cls).fingerprint)
    }
  })
})

describe('Werte-Vergleich', () => {
  it('zeigt geänderte, neue und entfernte Werte', () => {
    const before = new Map([['Abklingzeit', '60 s'], ['Schaden', '50'], ['Alt', '1']])
    const after = new Map([['Abklingzeit', '45 s'], ['Schaden', '50'], ['Neu', '+5']])
    expect(diffValues(before, after)).toEqual([
      { label: 'Abklingzeit', before: '60 s', after: '45 s' },
      { label: 'Neu', before: '—', after: '+5' },
      { label: 'Alt', before: '1', after: '—' },
    ])
  })

  it('nummeriert doppelte Labels durch', () => {
    const card = { ...byClass(cardsOf(englishItems), 'upgrade_clip_size') }
    card.sections = [{ type: 'innate', stats: [{ label: 'Munition', value: '1' }, { label: 'Munition', value: '2' }] }]
    expect([...displayedValues(card).keys()]).toEqual(['Kosten', 'Tier', 'Munition', 'Munition (2)'])
  })
})

describe('detectChanges', () => {
  const now = 1_700_000_000_000
  const before = cardsOf(englishItems)

  it('erster Sync und alte Karten ohne Fingerprint: nichts melden (nur einmessen)', () => {
    expect(detectChanges([], before, now)).toEqual([])
    const legacy = before.map(c => ({ ...c, fingerprint: undefined as unknown as string }))
    expect(detectChanges(legacy, before, now)).toEqual([])
    const otherVersion = before.map(c => ({ ...c, fingerprint: c.fingerprint.replace(/^v\d+/, 'v0') }))
    expect(detectChanges(otherVersion, before, now)).toEqual([])
  })

  it('unverändert: nichts', () => {
    expect(detectChanges(before, cardsOf(englishItems), now)).toEqual([])
  })

  it('meldet geänderte Karten mit Werte-Vergleich und neue Karten', () => {
    // Ein echter Patch ändert die Werte in beiden Sprachen
    const en = clone(englishItems)
    const de = clone(germanItems)
    en[2].properties!.AbilityCooldown.value = 45
    de[1].properties!.AbilityCooldown.value = 45
    en.push({ ...clone(en[0]), id: 99, class_name: 'upgrade_brand_new', name: 'Brand New' })
    const records = detectChanges(before, cardsOf(en, de), now).sort((a, b) => a.id.localeCompare(b.id))
    expect(records).toEqual([
      { id: 'item:upgrade_brand_new', detectedAt: now, kind: 'added', changes: [] },
      { id: 'item:upgrade_healing_rite', detectedAt: now, kind: 'changed', changes: [{ label: 'Abklingzeit', before: '60s', after: '45s' }] },
    ])
  })

  it('hinkt die deutsche Liste hinterher, wird die Änderung trotzdem erkannt (ohne Werte-Vergleich)', () => {
    const en = clone(englishItems)
    en[2].properties!.AbilityCooldown.value = 45
    expect(detectChanges(before, cardsOf(en), now)).toEqual([
      { id: 'item:upgrade_healing_rite', detectedAt: now, kind: 'changed', changes: [] },
    ])
  })
})

describe('Entfernte Karten', () => {
  const before = cardsOf(englishItems)
  it('findet entfernte Karten – aber nur mit Ausgangszustand', () => {
    const after = before.filter(c => c.className !== 'upgrade_titanic_magazine')
    expect(detectRemoved(before, after).map(c => c.name)).toEqual(['Titanic Magazine'])
    expect(detectRemoved([], after)).toEqual([])
    const legacy = before.map(c => ({ ...c, fingerprint: undefined as unknown as string }))
    expect(detectRemoved(legacy, after)).toEqual([])
  })
  it('benennt Fähigkeiten mit Hero', () => {
    expect(cardLabel(before[0])).toBe(before[0].name)
    const ability = { id: 'ability:x', name: 'Sleep Dagger', heroName: 'Haze' } as never
    expect(cardLabel(ability)).toBe('Sleep Dagger (Haze)')
  })
})

describe('Anzeige-Regeln', () => {
  const DAY = 86_400_000
  const changed: PatchRecord = { id: 'item:x', detectedAt: 1000, kind: 'changed', changes: [] }
  const added: PatchRecord = { ...changed, kind: 'added' }
  it('Lernkarte: Geändert bis zur ersten Wiederholung nach dem Patch', () => {
    expect(showPatchOnCard(changed, undefined, 2000)).toBe(true)
    expect(showPatchOnCard(changed, new Date(500), 2000)).toBe(true)
    expect(showPatchOnCard(changed, new Date(1500), 2000)).toBe(false)
    expect(showPatchOnCard(changed, undefined, 1000 + 60 * DAY)).toBe(true)
    expect(showPatchOnCard(undefined, undefined)).toBe(false)
  })
  it('Lernkarte: Neu höchstens 7 Tage', () => {
    expect(showPatchOnCard(added, undefined, 1000 + 6 * DAY)).toBe(true)
    expect(showPatchOnCard(added, undefined, 1000 + 7 * DAY)).toBe(false)
  })
  it('Shop-Kachel: Geändert 14 Tage, Neu 7 Tage', () => {
    expect(isRecentPatch(changed, 1000 + 13 * DAY)).toBe(true)
    expect(isRecentPatch(changed, 1000 + 15 * DAY)).toBe(false)
    expect(isRecentPatch(added, 1000 + 6 * DAY)).toBe(true)
    expect(isRecentPatch(added, 1000 + 8 * DAY)).toBe(false)
  })
  it('Shop-Detail: Geändert 30 Tage, Neu 7 Tage', () => {
    expect(showPatchNote(changed, 1000 + 29 * DAY)).toBe(true)
    expect(showPatchNote(changed, 1000 + 31 * DAY)).toBe(false)
    expect(showPatchNote(added, 1000 + 8 * DAY)).toBe(false)
  })
})

describe('Neue Karten zuerst', () => {
  it('neue Patch-Karten stehen vor allen übrigen neuen Karten – auch nach Ablauf des Badges', () => {
    const added: PatchRecord = { id: 'item:new', detectedAt: 0, kind: 'added', changes: [] }
    expect(newCardOrder(3, added)).toBe(3 - ADDED_PRIORITY)
    expect(newCardOrder(3, { ...added, kind: 'changed' })).toBe(3)
    expect(newCardOrder(3, undefined)).toBe(3)
    const cards = [
      { id: 'item:a', order: newCardOrder(1, undefined) },
      { id: 'item:b', order: newCardOrder(1, undefined) },
      { id: 'item:new', order: newCardOrder(4, added) },
    ]
    for (let s = 0; s < 10; s++) {
      expect(buildQueue({ cards, reviews: new Map(), now: new Date(), newLimit: 2, rng: () => s / 10 })[0]).toBe('item:new')
    }
  })
})

describe('Schutz vor unvollständigen API-Daten', () => {
  it('überspringt die Aktualisierung, wenn über 30 % eines Decks fehlen', () => {
    expect(() => assertPlausible(173, 172, 'Items')).not.toThrow()
    expect(() => assertPlausible(173, 122, 'Items')).not.toThrow()
    expect(() => assertPlausible(173, 120, 'Items')).toThrow(/weniger Items/)
    expect(() => assertPlausible(10, 2, 'Items')).not.toThrow() // kleine Decks (Tests) nicht prüfen
    expect(() => assertPlausible(0, 173, 'Items')).not.toThrow()
  })
})

describe('Sync mit Patch (Integration)', () => {
  afterEach(() => vi.unstubAllGlobals())

  function mockApi(en: ApiItem[], de: ApiItem[] = germanItems) {
    vi.stubGlobal('fetch', async (url: string) => ({
      ok: true,
      json: async () => (url.includes('/items') ? (url.includes('german') ? de : en) : url.includes('generic-data') ? {} : []),
    }))
  }

  it('erkennt den Patch, macht gelernte Karten fällig und merkt sich die Zusammenfassung', async () => {
    const database = new DeckDB(`p-${Math.random()}`)
    mockApi(englishItems)
    expect((await syncItems(database)).patchChanges).toBe(0)

    // Healing Rite lernen → fällig erst in der Zukunft
    let t = new Date()
    for (let i = 0; i < 4; i++) t = (await rateCard('item:upgrade_healing_rite', true, t, database)).due
    expect((await database.reviews.get('item:upgrade_healing_rite'))!.due.getTime()).toBeGreaterThan(Date.now())

    const patched = clone(englishItems)
    const patchedDe = clone(germanItems)
    patched[2].properties!.AbilityCooldown.value = 45
    patchedDe[1].properties!.AbilityCooldown.value = 45
    patched.push({ ...clone(patched[0]), id: 99, class_name: 'upgrade_brand_new', name: 'Brand New' })
    mockApi(patched, patchedDe)
    const result = await syncItems(database)
    expect(result.patchChanges).toBe(2)

    const rec = await database.patches.get('item:upgrade_healing_rite')
    expect(rec).toMatchObject({ kind: 'changed', changes: [{ label: 'Abklingzeit', before: '60s', after: '45s' }] })
    expect(await database.patches.get('item:upgrade_brand_new')).toMatchObject({ kind: 'added' })
    const review = (await database.reviews.get('item:upgrade_healing_rite'))!
    expect(review.due.getTime()).toBeLessThanOrEqual(Date.now())
    expect(review.state).toBe(State.Review) // Lernverlauf bleibt
    expect(await getMeta<LastPatch | null>('lastPatch', null, database)).toMatchObject({
      changed: 1, added: 1, removed: 0, addedNames: ['Brand New'], removedNames: [],
    })

    // Ein weiterer Sync ohne Änderung meldet nichts Neues, der Eintrag bleibt erhalten
    expect((await syncItems(database)).patchChanges).toBe(0)
    expect(await database.patches.count()).toBe(2)

    // Item fällt weg: wird mit Namen gemeldet, sein Patch-Eintrag aufgeräumt, der Lernstand bleibt
    mockApi(patched.filter(i => i.class_name !== 'upgrade_brand_new'), patchedDe)
    expect((await syncItems(database)).patchChanges).toBe(1)
    expect(await getMeta<LastPatch | null>('lastPatch', null, database)).toMatchObject({
      changed: 0, added: 0, removed: 1, removedNames: ['Brand New'],
    })
    expect(await database.patches.get('item:upgrade_brand_new')).toBeUndefined()
    expect(await database.items.get('item:upgrade_brand_new')).toBeUndefined()
    expect(await database.reviews.get('item:upgrade_healing_rite')).toBeDefined()
  })

  it('behält den alten Stand, wenn die API plötzlich viel weniger liefert', async () => {
    const many: ApiItem[] = Array.from({ length: 30 }, (_, i) => ({ ...clone(englishItems[0]), id: 500 + i, class_name: `upgrade_many_${i}`, name: `Many ${i}` }))
    const database = new DeckDB(`g-${Math.random()}`)
    mockApi(many, [])
    await syncItems(database)
    expect(await database.items.count()).toBe(30)
    mockApi(many.slice(0, 10), [])
    await expect(syncItems(database)).rejects.toThrow(/deutlich weniger Items/)
    expect(await database.items.count()).toBe(30)
    expect(await getMeta('lastPatch', null, database)).toBeNull()
  })
})
