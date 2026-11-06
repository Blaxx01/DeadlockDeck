/**
 * Navigation über den Browser-Verlauf: Jede Ansicht (und jede Shop-Detailseite) ist ein
 * Verlaufseintrag. So führt „Zurück“ – auch die Android-Geste – einen Schritt zurück,
 * statt die App zu schließen.
 */
import type { DeckId } from './decks'

export type View =
  | { name: 'home' }
  /** deck fehlt bei Verlaufseinträgen von vor den Hero-Decks → Items */
  | { name: 'learn'; deck?: DeckId; extraNew?: number }
  | { name: 'quiz' }
  | { name: 'guess' }
  | { name: 'builds' }
  | { name: 'shop' }
  | { name: 'settings' }

export interface NavState {
  view?: View
  /** Geöffnete Item-Detailseite (Karten-ID) – im Shop, über der Lernsession oder im Build-Quiz */
  item?: string
}

export function currentNav(): NavState {
  return (window.history.state as NavState | null) ?? {}
}

export function viewOf(state: NavState | null | undefined): View {
  return state?.view ?? { name: 'home' }
}

export function pushNav(state: NavState): void {
  window.history.pushState(state, '')
}
