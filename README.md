# DeadlockDeck

Karteikarten-App fürs Handy zum Lernen der **Deadlock**-Items, auch offline unterwegs.
Vorne das Item-Bild, hinten Kosten, Kategorie, Tier, Stats, Aktiv-/Passiv-Effekt, Cooldown und Build-Pfad.
Gelernt wird mit Spaced Repetition (FSRS): **Antippen** dreht die Karte um, **Swipe rechts** = gewusst, **Swipe links** = nicht gewusst.

Dazu gibt es ein **Quiz** mit Runden à 10 Fragen (Bild → Name, Effekt → Item, Cooldown/Kosten/Tier, Build-Pfad),
Punkten mit Zeitbonus und Highscore.

Was geplant ist (Quiz, Hero-Decks, Hero-Erraten …): siehe [SPEC.md](SPEC.md).

## Aufs Handy

1. Die GitHub-Pages-URL im Handy-Browser öffnen (`https://<user>.github.io/DeadlockDeck/`)
2. **Android/Chrome:** Menü → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“
   **iPhone/Safari:** Teilen → „Zum Home-Bildschirm“
3. Einmal mit Internet öffnen. Die App lädt alle Items und Bilder, danach geht alles offline.

Der Lernfortschritt liegt nur auf dem Gerät. Unter ⚙ → *Backup* lässt er sich als Datei exportieren und wieder importieren.

## Entwicklung

```bash
npm install
npm run dev      # Dev-Server
npm test         # Unit-Tests (Vitest)
npm run lint     # oxlint
npm run build    # Produktions-Build nach dist/
```

Aufbau:

| Pfad | Inhalt |
|---|---|
| `src/data/normalize.ts` | API-Items → Karteikarten (englische Namen, deutsche Texte) |
| `src/data/sync.ts` | Laden von der API, Bilder für offline vorladen |
| `src/data/db.ts` | IndexedDB (Dexie): Karten, Fortschritt, Tagesstatistik, Einstellungen |
| `src/srs/srs.ts` | Lernlogik: Warteschlange, FSRS-Bewertung, Streak |
| `src/quiz/quiz.ts` | Quiz: Fragetypen, ähnliche falsche Antworten, Runden, Punkte |
| `src/views/Quiz.tsx` | Quiz-Ansicht mit Auflösung und Ergebnis |
| `src/components/FlashCard.tsx` | Karte mit Umdrehen + Swipe |

## Deploy (GitHub Pages)

Der Workflow `.github/workflows/deploy.yml` baut und veröffentlicht bei jedem Push auf `main`
(oder manuell unter *Actions → Deploy to GitHub Pages → Run workflow*). Einmalig einrichten:

1. Repo auf **öffentlich** stellen (GitHub Pages braucht das bei Free-Accounts)
2. *Settings → Pages → Source:* **GitHub Actions**
3. `main` als Standard-Branch

## Daten

Item-Daten und Bilder kommen von der Community-API [deadlock-api.com](https://deadlock-api.com).
Inoffizielles Fan-Projekt, nicht mit Valve verbunden.
