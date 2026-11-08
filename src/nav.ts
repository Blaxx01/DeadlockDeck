/**
 * Navigation über den Browser-Verlauf: Jede Ansicht (und jede Shop-Detailseite) ist ein
 * Verlaufseintrag. So führt „Zurück“ – auch die Android-Geste – einen Schritt zurück,
 * statt die App zu schließen.
 */
import type { LearnDeck } from './decks'
import type { MapKind } from './map/mapData'

export type View =
  | { name: 'home' }
  /** deck fehlt bei Verlaufseinträgen von vor den Hero-Decks → Items; „all“ = Alles lernen */
  | { name: 'learn'; deck?: LearnDeck; extraNew?: number }
  | { name: 'quiz' }
  | { name: 'guess' }
  /** Build-Quiz; `hero`: gleich mit diesem Hero starten (Held des Tages) */
  | { name: 'builds'; hero?: number }
  /** 60-Sekunden-Sprint */
  | { name: 'sprint' }
  /** Überleben (3 Leben) */
  | { name: 'survival' }
  | { name: 'weak' }
  | { name: 'shop' }
  /** Hero-Meisterschaft (Sterne je Hero) */
  | { name: 'heroes' }
  /** Statistik (Kachel auf der Startseite) */
  | { name: 'stats' }
  /** Alle Ränge (über die Rang-Karte) */
  | { name: 'ranks' }
  /** Map zum Nachschlagen; `focus`: diese Art gleich hervorheben */
  | { name: 'map'; focus?: MapKind }
  /** Map-Quiz */
  | { name: 'mapquiz' }
  /** Lane-Angriff des Tages auf der Map (über die Leiste im Feld „Heute“) */
  | { name: 'lane' }
  /** Held des Tages: Session mit seinen Karten */
  | { name: 'herolearn' }
  | { name: 'settings' }

export interface NavState {
  view?: View
  /** Geöffnete Item-Detailseite (Karten-ID) – im Shop, über der Lernsession oder im Build-Quiz */
  item?: string
  /** Geöffnete Hero-Seite der Meisterschaft (Hero-Karten-ID) */
  hero?: string
  /** Merkhilfe bearbeiten (Karten-ID) – über der Lernsession */
  note?: string
  /** Map über dem Map-Quiz-Ergebnis („Auf der Map zeigen“) mit dieser Art */
  mapFocus?: MapKind
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
