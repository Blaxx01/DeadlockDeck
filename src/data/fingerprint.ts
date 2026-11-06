import type { ApiItemProperty } from './apiTypes'

/**
 * Fingerprints erkennen Spiel-Patches: Sie werden nur aus Spielwerten der API gebildet
 * (Kosten, Tier, Bauteile, Werte, Upgrades …) – nicht aus Texten, Übersetzungen, Bild-URLs
 * oder der Formatierung der App. Sonst sähe ein App-Update wie ein Patch aus.
 *
 * Ändert sich die Berechnung, FINGERPRINT_VERSION erhöhen: Alte Fingerprints werden dann
 * still neu eingemessen statt als Änderung gemeldet.
 */
export const FINGERPRINT_VERSION = 1

/** FNV-1a */
export function hashString(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function makeFingerprint(parts: unknown): string {
  return `v${FINGERPRINT_VERSION}:${hashString(JSON.stringify(parts))}`
}

/** Stammen beide Fingerprints aus derselben Berechnung? Nur dann ist ein Unterschied ein Patch. */
export function sameFingerprintVersion(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  return a.split(':')[0] === b.split(':')[0]
}

/** Zahlen vereinheitlichen ("30.0" = "30" = 30), Einheiten am Wert ignorieren ("2m" = 2) */
export function normValue(value: unknown): string {
  const s = String(value ?? '').trim()
  const m = s.match(/^([+-]?\d*\.?\d+)\s*[a-zA-Z%/]*$/)
  if (m) return String(Math.round(Number.parseFloat(m[1]) * 1e4) / 1e4)
  return s
}

/** Sichtbare Werte als sortierte [Schlüssel, Wert]-Paare (Labels zählen nicht – sie ändern sich mit Übersetzungen) */
export function propertyValues(
  props: Record<string, ApiItemProperty> | null | undefined,
  visible: (p: ApiItemProperty | undefined) => boolean,
): [string, string][] {
  return Object.entries(props ?? {})
    .filter(([, p]) => visible(p))
    .map(([k, p]): [string, string] => [k, normValue(p.value)])
    .sort(([a], [b]) => a.localeCompare(b))
}

export function bonusPairs(list: { name: string; bonus: string | number }[] | null | undefined): [string, string][] {
  return (list ?? []).map((u): [string, string] => [u.name, normValue(u.bonus)]).sort(([a], [b]) => a.localeCompare(b))
}
