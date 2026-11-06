/** Effekte (Animationen, Vibration) – in den Einstellungen abschaltbar */

let enabled = true

export function setEffectsEnabled(value: boolean): void {
  enabled = value
}

export function effectsEnabled(): boolean {
  return enabled
}

/** Kurze Vibration bei Fehlern (nur Geräte, die es können – z. B. Android) */
export function vibrate(pattern: number | number[] = 60): void {
  if (!enabled || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  try {
    navigator.vibrate(pattern)
  } catch {
    // manche Browser verbieten es ohne Nutzerinteraktion
  }
}
