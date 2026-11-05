# DeadlockDeck – Spezifikation

Lern-App fürs Handy zu **Deadlock (Valve)**: Karteikarten mit Spaced Repetition, Quiz und
Hero-Erraten. Gedacht für kurze Sessions unterwegs, auch ohne Netz.

## Grundlagen

| Thema | Entscheidung |
|---|---|
| Spiel | Deadlock (Valve): Heroes, Abilities, Shop-Items (Weapon / Vitality / Spirit) |
| Datenquelle | Community-API `https://api.deadlock-api.com/v1/assets/…` (Items, Heroes, Abilities), Bilder vom CDN `assets-bucket.deadlock-api.com` |
| Plattform | PWA (im Browser öffnen → „Zum Home-Bildschirm“), iOS + Android |
| Stack | Vite + React + TypeScript, `vite-plugin-pwa` (Workbox), Dexie (IndexedDB), `ts-fsrs` (SRS) |
| Offline | Offline-first: Daten liegen in IndexedDB, Bilder im Service-Worker-Cache. Nach dem ersten Sync läuft alles ohne Netz |
| Hosting | GitHub Pages, Deploy per GitHub Action bei Push auf `main` (Repo muss öffentlich sein) |
| Sprache | UI Deutsch. Item-/Hero-/Ability-**Namen Englisch** (wie ingame), **Beschreibungen und Stats Deutsch** (`language=german`), Fallback Englisch |

## Decks (Karteikarten)

1. **Items**: vorne Item-Bild, hinten:
   - Name, Kosten (Souls), Kategorie (Weapon/Vitality/Spirit), Tier
   - Stats (Boni) und Aktiv-/Passiv-Text
   - Cooldown, Dauer, Reichweite (wenn vorhanden)
   - Build-Pfad: „Baut auf“ (Komponenten) und „Upgradet zu“
2. **Hero-Abilities**: vorne Ability-Icon, hinten Hero und Effekt
3. **Hero-Übersicht**: vorne Hero-Porträt, hinten Rolle, Stats, Abilities

### Lernmodus
- Spaced Repetition (FSRS). Antippen = umdrehen. **Swipe rechts = gewusst, links = nicht gewusst**
- Nicht gewusste Karten kommen in derselben Session nochmal
- **Tagesziel** (z. B. 20 Karten) mit **Streak**-Zähler, jederzeit abbrechbar ohne Verlust
- Limit für neue Karten pro Tag

### Patches
- Jede Karte speichert einen Hash ihres Inhalts. Ändert ein Patch den Inhalt, wird die Karte
  **zurückgesetzt** (kommt sofort wieder dran) und bekommt das Badge **„Geändert im Patch“**

## Quiz
- Fragetypen: **Bild → Name**, **Beschreibung → Item**, **Zahlen** (Kosten, Cooldown, Tier),
  **Build-Pfad** („In was upgradet X?“)
- Multiple Choice mit 4 Antworten; falsche Antworten bevorzugt **ähnlich** (gleiche Kategorie/Tier, ähnliche Kosten)
- Runden à 10 Fragen mit Punktestand und Highscore

## Hero erraten
- Bildquellen: offizielle Assets und **eigene Ingame-Screenshots**
- Varianten: **Silhouette**, **Zoom-Ausschnitt**, **Unscharf → scharf**, **Ability-Icon → Hero**
- Antwort: zuerst **Hero-Grid** (alle Porträts); als Joker auf **4 Antworten** reduzieren
- Punkte: Start 100, jede Aufdeck-Stufe −20, Joker halbiert, falscher Tipp −15
- Runden mit Highscore
- Eigene Screenshots:
  - In der App hochladen und Hero zuordnen (nur lokal in IndexedDB)
  - Im Repo unter `public/screenshots/<hero>/…` ablegen (per Deploy auf allen Geräten)
  - Export/Import, um App-Screenshots ins Repo zu übernehmen
  - **Nur eigene Screenshots ins Repo, keine YouTube-Frames** (das Repo ist öffentlich)

## Daten & Fortschritt
- Fortschritt, Einstellungen, Highscores und Screenshots: lokal in IndexedDB
- **Export/Import** als JSON-Datei (Backup / Gerätewechsel)

## Reihenfolge
1. **MVP:** Item-Karten + SRS + Offline + Export/Import + Deploy
2. Quiz
3. Hero-Decks (Abilities, Übersicht)
4. Hero erraten (offizielle Assets)
5. Eigene Screenshots
6. Patch-Erkennung (Reset + Badge)

## Offene Punkte / Risiken
- Wo die API keine deutschen Texte liefert, wird auf Englisch zurückgefallen.
- Bilder vom CDN werden als „opaque“ gecacht, falls das CDN kein CORS sendet; Chrome rechnet
  diese mit Puffer aufs Speicherkontingent an. Bei Problemen: Bilder als Blobs in IndexedDB speichern.
