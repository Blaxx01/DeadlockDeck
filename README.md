# DeadlockDeck

Karteikarten-App fürs Handy zum Lernen der **Deadlock**-Items, auch offline unterwegs.
Vier Kartendecks: **Items** (vorne Bild, hinten Kosten, Tier, Stats, Effekt, Cooldown, Build-Pfad),
**Fähigkeiten** (Ability-Icon → Hero, Effekt, Upgrades mit AP-Kosten), **Heroes** (Porträt → Rolle, Fähigkeiten, Werte)
und **Counter** (Hero → die 3 Items, die Spieler ab Orakel gegen ihn am deutlichsten öfter kaufen, mit Kauf-Faktor –
Statistik der API, wöchentlich aktualisiert).
Gelernt wird mit Spaced Repetition (FSRS): **Antippen** dreht die Karte um, **Swipe rechts** = gewusst, **Swipe links** = nicht gewusst.
Items im Build-Pfad sind antippbar und öffnen die Detailseite aus dem Shop; **Zurück** führt wieder in die Lernsession.

Dazu gibt es ein **Quiz** mit Runden à 10 Fragen (Bild → Name, Effekt → Item, Cooldown/Kosten/Tier, Build-Pfad, Counter),
Punkten mit Zeitbonus und Highscore, einen **Shop** zum Nachschlagen – aufgebaut wie ingame, mit Suche,
Detailseiten (inkl. Broker-Variante) und „Jetzt lernen“ –, **Hero erraten**: Silhouette, Zoom-Ausschnitt,
unscharf → scharf oder an einer Fähigkeit, mit Aufdecken, Joker und Highscore – und das **Build-Quiz**: alle Items
eines Hero-Builds (typischer Build aus den Kaufdaten oder meistgespielter Community-Build) Icon für Icon benennen,
mit Bestwert je Hero und „Fehler-Items lernen“.

Fürs Dranbleiben gibt es **Souls & Rang**: jede Lern-Aktion bringt Souls (je Karte gleich viel, ob gewusst oder nicht),
die Summe bestimmt den Rang mit den echten Deadlock-Abzeichen (Unwissender → Ewiger 6, rund ein halbes Jahr bei
täglichem Lernen). Dazu **3 Tagesmissionen**, **Streak-Schutz** (alle 7 Tage einer) und ein leichter **Rang-Verfall**
ab dem 6. Tag ohne Lernen. **Schwächen üben** sammelt Fehler aus allen Modi (14 Tage) und trainiert die
häufigsten gezielt – „gewusst“ im Training behebt die Schwäche. Was wirklich sitzt, zeigt das **Sammelalbum** im Shop
(Rahmen Bronze/Silber/Gold je nach Abstand bis zur nächsten Wiederholung), die **Hero-Meisterschaft** (5 Sterne je Hero:
Hero-, Fähigkeiten- und Counter-Karte, Build-Quiz ohne Fehler, Hero erraten ohne Hilfe) und die **Statistik** mit
Kalender der Lerntage, Souls-Verlauf und Karten je Deck. Neue Silber- und Gold-Karten und neue Sterne bringen
**Meilenstein-Souls**.

Nach einem **Spiel-Patch** erkennt die App beim nächsten Sync geänderte und neue Karten, zeigt „vorher → nachher“
und holt schon gelernte geänderte Karten sofort in die Wiederholung.

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
| `src/data/heroes.ts` | API-Heroes + Abilities → Hero- und Fähigkeiten-Karten |
| `src/decks.ts` | Die vier Decks, Neu-Limit je Deck |
| `src/guess/guess.ts`, `src/views/Guess.tsx` | Hero erraten: Runden, Aufdeck-Stufen, Joker, Punkte |
| `src/data/fingerprint.ts`, `src/data/patches.ts` | Patch-Erkennung: Fingerprints der Spielwerte, Vergleich, „vorher → nachher“ |
| `src/data/counters.ts`, `src/data/counterSync.ts` | Counter: Kauf-Faktor aus der API-Statistik, Top 3, wöchentliches Laden, Wechsel des Top-Counters |
| `src/data/builds.ts`, `src/data/buildSync.ts` | Builds: typischer Build (meistgekauft, nach Kaufzeit) und meistgespielter Community-Build, wöchentlich |
| `src/builds/buildQuiz.ts`, `src/views/BuildQuiz.tsx` | Build-Quiz: Runde Icon für Icon, Extra-Namen, Fehler, Bestwerte |
| `src/game/souls.ts`, `src/game/ranks.ts` | Souls-Konto (Verlauf, Rundenregel, Verfall, rückwirkende Gutschrift) und Rangstufen |
| `src/game/missions.ts` | Tagesmissionen und Tagesziel-Bonus |
| `src/game/weakness.ts`, `src/views/Weakness.tsx` | Schwächen: Fehler aus allen Modi, Rangfolge, Training |
| `src/game/mastery.ts`, `src/game/heroMastery.ts` | Stufe einer Karte (Bronze/Silber/Gold), Sterne je Hero |
| `src/game/milestones.ts` | Meilenstein-Souls (Silber, Gold, Hero-Sterne), nachträgliches Gutschreiben |
| `src/game/stats.ts`, `src/views/Stats.tsx` | Statistik: Kalender der Lerntage, Souls-Verlauf, Karten je Deck |
| `src/views/Heroes.tsx` | Hero-Meisterschaft: Raster mit Sternen, Hero-Seite |
| `src/components/SoulsFx.tsx` | „+10 ◆“-Animation und Aufstieg mit Konfetti |
| `src/data/sync.ts` | Laden von der API, Bilder für offline vorladen |
| `src/data/db.ts` | IndexedDB (Dexie): Karten, Fortschritt, Tagesstatistik, Einstellungen |
| `src/srs/srs.ts` | Lernlogik: Warteschlange, FSRS-Bewertung, Streak |
| `src/quiz/quiz.ts` | Quiz: Fragetypen, ähnliche falsche Antworten, Runden, Punkte |
| `src/views/Quiz.tsx` | Quiz-Ansicht mit Auflösung und Ergebnis |
| `src/views/Shop.tsx`, `src/views/ItemDetail.tsx` | Shop (Tabs, Tiers, Suche, Sammelalbum) und Item-Detailseite |
| `src/shop/search.ts` | Shop-Aufbau und Suche (Name + Effekttext) |
| `src/nav.ts` | Navigation über den Browser-Verlauf (Zurück-Geste) |
| `src/components/FlashCard.tsx` | Karte mit Umdrehen + Swipe |

## Deploy (GitHub Pages)

Der Workflow `.github/workflows/deploy.yml` baut und veröffentlicht bei jedem Push auf `main`
(oder manuell unter *Actions → Deploy to GitHub Pages → Run workflow*). Einmalig einrichten:

1. Repo auf **öffentlich** stellen (GitHub Pages braucht das bei Free-Accounts)
2. *Settings → Pages → Source:* **GitHub Actions**
3. `main` als Standard-Branch

## Daten

Item-Daten, Bilder, die Counter-Statistik und die Builds kommen von der Community-API [deadlock-api.com](https://deadlock-api.com).
Inoffizielles Fan-Projekt, nicht mit Valve verbunden.
