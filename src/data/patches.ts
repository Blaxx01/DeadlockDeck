import { sameFingerprintVersion } from './fingerprint'
import { abilitySlotLabel, type AbilityCard, type HeroCard, type ItemCard } from './model'

export interface StatChange {
  label: string
  /** „—“ = vorher nicht vorhanden */
  before: string
  /** „—“ = entfernt */
  after: string
}

/** Eine im Sync erkannte Änderung an einer Karte (pro Karte nur die neueste) */
export interface PatchRecord {
  /** Karten-ID */
  id: string
  detectedAt: number
  kind: 'changed' | 'added'
  /** Geänderte angezeigte Werte; leer = Änderung nur an Werten, die die Karte nicht zeigt */
  changes: StatChange[]
}

export type AnyCard = ItemCard | AbilityCard | HeroCard

const NONE = '—'

function stripHtml(html: string): string {
  return html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

function isItem(card: AnyCard): card is ItemCard {
  return card.id.startsWith('item:')
}

function isAbility(card: AnyCard): card is AbilityCard {
  return card.id.startsWith('ability:')
}

/** Angezeigte Werte einer Karte als Label → Wert (doppelte Labels werden durchnummeriert) */
export function displayedValues(card: AnyCard): Map<string, string> {
  const pairs: [string, string][] = []
  if (isItem(card)) {
    if (card.cost) pairs.push(['Kosten', `${card.cost.toLocaleString('de-DE')} Souls`])
    pairs.push(['Tier', String(card.tier)])
    for (const t of card.timings) pairs.push([t.label, t.value])
    for (const s of card.sections) for (const st of s.stats) pairs.push([st.label, st.value])
    if (card.buildsFrom.length) pairs.push(['Baut auf', card.buildsFrom.join(', ')])
  } else if (isAbility(card)) {
    for (const t of card.timings) pairs.push([t.label, t.value])
    for (const st of card.stats) pairs.push([st.label, st.value])
    for (const u of card.upgrades) pairs.push([`Upgrade ${u.cost} AP`, stripHtml(u.html)])
  } else {
    for (const st of card.stats) pairs.push([st.label, st.value])
    for (const st of card.weapon?.stats ?? []) pairs.push([`Waffe: ${st.label}`, st.value])
    for (const a of card.abilities) pairs.push([abilitySlotLabel(a.slot), a.name])
  }
  const map = new Map<string, string>()
  for (const [label, value] of pairs) {
    let key = label
    for (let n = 2; map.has(key); n++) key = `${label} (${n})`
    map.set(key, value)
  }
  return map
}

export function diffValues(before: Map<string, string>, after: Map<string, string>): StatChange[] {
  const changes: StatChange[] = []
  for (const [label, value] of after) {
    const old = before.get(label)
    if (old === undefined) changes.push({ label, before: NONE, after: value })
    else if (old !== value) changes.push({ label, before: old, after: value })
  }
  for (const [label, value] of before) if (!after.has(label)) changes.push({ label, before: value, after: NONE })
  return changes
}

/**
 * Vergleicht die bisher gespeicherten Karten eines Decks mit den neuen.
 * - geänderter Fingerprint (gleiche Version) → 'changed' mit Werte-Vergleich
 * - neue Karte, wenn das Deck vorher schon Karten hatte → 'added'
 * - erster Sync, alte Karten ohne/mit anderer Fingerprint-Version → nichts (neu einmessen)
 */
export function detectChanges(oldCards: readonly AnyCard[], newCards: readonly AnyCard[], now: number): PatchRecord[] {
  const old = new Map(oldCards.map(c => [c.id, c]))
  const baseline = oldCards.some(c => sameFingerprintVersion(c.fingerprint, newCards[0]?.fingerprint))
  if (!baseline) return []
  const records: PatchRecord[] = []
  for (const card of newCards) {
    const before = old.get(card.id)
    if (!before) {
      records.push({ id: card.id, detectedAt: now, kind: 'added', changes: [] })
    } else if (sameFingerprintVersion(before.fingerprint, card.fingerprint) && before.fingerprint !== card.fingerprint) {
      records.push({ id: card.id, detectedAt: now, kind: 'changed', changes: diffValues(displayedValues(before), displayedValues(card)) })
    }
  }
  return records
}

/** Karten, die es nicht mehr gibt – nur wenn ein Ausgangszustand mit gleicher Fingerprint-Version existiert */
export function detectRemoved(oldCards: readonly AnyCard[], newCards: readonly AnyCard[]): AnyCard[] {
  const baseline = oldCards.some(c => sameFingerprintVersion(c.fingerprint, newCards[0]?.fingerprint))
  if (!baseline) return []
  const ids = new Set(newCards.map(c => c.id))
  return oldCards.filter(c => !ids.has(c.id))
}

/** Name für Hinweise; bei Fähigkeiten mit Hero, z. B. „Sleep Dagger (Haze)“ */
export function cardLabel(card: AnyCard): string {
  return isAbility(card) ? `${card.name} (${card.heroName})` : card.name
}

const DAY = 86_400_000
/** „Geändert“ im Shop */
export const CHANGED_BADGE_DAYS = 14
/** „Geändert“ auf der Shop-Detailseite */
export const CHANGED_NOTE_DAYS = 30
/** „Neu“ überall */
export const ADDED_BADGE_DAYS = 7

function ageInDays(patch: PatchRecord, now: number): number {
  return (now - patch.detectedAt) / DAY
}

/**
 * Zeigt die Lernkarte das Patch-Badge?
 * Geändert: bis die Karte nach der Änderung einmal wiederholt wurde. Neu: zusätzlich höchstens 7 Tage.
 */
export function showPatchOnCard(patch: PatchRecord | undefined, lastReview: Date | undefined, now = Date.now()): boolean {
  if (!patch) return false
  if (patch.kind === 'added' && ageInDays(patch, now) >= ADDED_BADGE_DAYS) return false
  return !lastReview || lastReview.getTime() < patch.detectedAt
}

/** Badge an der Shop-Kachel: Geändert 14 Tage, Neu 7 Tage */
export function isRecentPatch(patch: PatchRecord | undefined, now = Date.now()): boolean {
  if (!patch) return false
  return ageInDays(patch, now) < (patch.kind === 'added' ? ADDED_BADGE_DAYS : CHANGED_BADGE_DAYS)
}

/** Hinweis auf der Shop-Detailseite: Geändert 30 Tage, Neu 7 Tage */
export function showPatchNote(patch: PatchRecord | undefined, now = Date.now()): boolean {
  if (!patch) return false
  return ageInDays(patch, now) < (patch.kind === 'added' ? ADDED_BADGE_DAYS : CHANGED_NOTE_DAYS)
}

/** Neue Karten aus einem Patch kommen vor allen übrigen neuen Karten (auch nach Ablauf des Badges) */
export const ADDED_PRIORITY = 1_000_000

export function newCardOrder(order: number, patch: PatchRecord | undefined): number {
  return patch?.kind === 'added' ? order - ADDED_PRIORITY : order
}
