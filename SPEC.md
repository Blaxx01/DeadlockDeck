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
2. **Fähigkeiten** (die 4 Abilities jedes spielbaren Heroes): vorne Ability-Icon in Hero-Farbe, hinten:
   - Name (englisch), Hero, Slot (Fähigkeit 1–3 / Ultimate), Kurzsatz
   - Cooldown, Dauer, Reichweite, Aufladungen; Effekttext und Werte
   - Upgrades mit Kosten **1 / 2 / 5 AP** (Texte der API, sonst aus den Upgrade-Werten gebaut)
   - Neue Karten kommen Hero für Hero (alphabetisch), damit ein Kit zusammen gelernt wird
3. **Heroes**: vorne Hero-Porträt, hinten:
   - Name, Tags (z. B. Tank, Raufbold), Waffentyp, Komplexität (1–4), Rolle, Spielstil
   - die 4 Fähigkeiten mit Icons, Startwerte (Leben, Lauftempo, Ausdauer, Nahkampf …), Waffe (Kugelschaden, Magazin, Nachladen)
   - Rolle/Spielstil fehlen in der API bei neueren Heroes – dann nur Tags und Werte
4. **Counter** (je spielbarem Hero eine Karte): vorne Hero-Porträt mit „Was kaufst du gegen X?“, hinten:
   - die **Top 3 Counter-Items** mit Icon, Name, **Kauf-Faktor** (z. B. 2,1×) und dem ersten Satz ihres Effekts
   - Items antippbar → Item-Detailseite (wie beim Build-Pfad)
   - Fußzeile mit der Datenbasis („ab Orakel · letzte 30 Tage · Stand …“)
   - Alle Heroes, immer 3 Items – auch ohne klaren Counter (der Faktor zeigt, wie deutlich es ist)
   - Neue Karten: **klarste Counter zuerst** (höchster Faktor des Top-Items)

Die Startseite zeigt die vier Decks untereinander mit „fällig · neu · gelernt“ und eigenem Lernen-Button.

### Lernmodus
- Spaced Repetition (FSRS). Antippen = umdrehen. **Swipe rechts = gewusst, links = nicht gewusst**
- Item-Karten: **Build-Pfad antippbar** („Baut auf“ / „Upgradet zu“) – öffnet die Item-Detailseite wie im Shop
  über der Session; **Zurück** (Pfeil, Android-Geste, Esc) führt zur selben Karte zurück, noch umgedreht.
  Antippen eines Links dreht die Karte nicht um, Wischen geht dort trotzdem
- Nicht gewusste Karten kommen in derselben Session nach ein paar anderen Karten nochmal; ist es die **letzte**
  Karte, endet die Session (sofort wieder zeigen bringt nichts) – sie ist in ein paar Minuten wieder fällig
- **Tagesziel** (z. B. 20 Karten) mit **Streak**-Zähler, jederzeit abbrechbar ohne Verlust; es zählt
  **verschiedene Karten pro Tag** – dieselbe Karte mehrfach zu bewerten zählt nur einmal
- Limit für neue Karten pro Tag, **je Deck**; Tagesziel und Streak zählen alle Decks zusammen

### Patches
- Jede Karte speichert einen **Fingerprint ihrer Spielwerte** (aus den englischen API-Rohdaten):
  - Items: Kosten, Tier, Kategorie, Aktiv, Bauteile, Werte, Broker-Boni
  - Fähigkeiten: Werte und Upgrade-Werte; Heroes: Startwerte, Waffenwerte, die 4 Abilities
  - **Nicht** enthalten: Texte, Übersetzungen, Labels, Bild-URLs, Formatierung der App → App-Updates
    und Übersetzungskorrekturen lösen keinen Fehlalarm aus
  - Fingerprints sind versioniert; ändert sich die Berechnung, wird still neu eingemessen
- Bei jedem Sync (automatisch alle 24 h mit Netz oder „Items neu laden“) werden alte und neue Karten verglichen:
  - **Geändert**: Patch-Eintrag mit **„vorher → nachher“** der angezeigten Werte; schon gelernte Karten werden
    **sofort fällig** (Lernverlauf bleibt)
  - **Neu** (wenn das Deck vorher schon Karten hatte): Eintrag „Neu im Patch“; neue Karten kommen beim Lernen
    **vor allen übrigen neuen Karten**
  - **Entfernt**: Karte verschwindet aus Deck, Shop und Quiz; der Lernstand bleibt gespeichert (kommt sie zurück,
    ist er wieder da)
  - **Schutz vor API-Pannen**: Fehlen plötzlich über 30 % eines Decks, wird die Aktualisierung übersprungen
    und der alte Stand behalten
- Anzeige:
  - Lernkarte: „Geändert“ vorne + „vorher → nachher“ hinten, bis die Karte nach dem Patch einmal wiederholt wurde;
    „Neu im Patch“ höchstens 7 Tage
  - Shop: Badge „Geändert“ (14 Tage) / „Neu“ (7 Tage) an der Kachel; Detailseite: Geändert 30 Tage, Neu 7 Tage
  - Startseite: Hinweis „Patch erkannt“ mit Anzahl und Namen der neuen und entfernten Karten (7 Tage, wegklickbar)

### Counter-Daten
- Quelle: Deadlock-API `/v1/analytics/item-stats` – nach Gegner-Hero gruppiert (`bucket=enemy_hero`) und als Vergleich
  ohne Gruppierung; nur Matches **ab Orakel** (`min_average_badge=81`), letzte 30 Tage
- **Kauf-Faktor** = Anteil eines Items an allen Käufen gegen Hero X ÷ sein Anteil an allen Käufen;
  2,1× = wird gegen X 2,1-mal so oft gekauft wie sonst
  - bewusst **nicht die Gewinnrate**: die ist verzerrt (Counter-Items kauft man oft erst, wenn man schon hinten liegt –
    Knockdown gegen Vindicta hätte eine negative Gewinnrate)
- Nur kaufbare Items mit genug Daten (mind. 2.000 Käufe gegen den Hero); Heroes ohne genug Daten (z. B. brandneu)
  bekommen noch keine Karte
- **Klarer Counter** = Faktor ≥ 1,3×
- Aktualisierung höchstens **einmal pro Woche** beim normalen Sync (≈ 0,5 MB, dauert ein paar Sekunden). Lehnt die API
  die Abfrage ab (passiert bei Last), bleiben die alten Daten und der nächste Sync versucht es erneut
- Änderungen: Wechselt das wichtigste Item eines Heroes und ist das neue ein klarer Counter, wird die Karte (wenn schon
  gelernt) **sofort fällig** und zeigt „Top-Counter geändert: vorher → nachher“, bis sie einmal wiederholt wurde.
  Alle anderen Verschiebungen in den Top 3 werden still übernommen (die Plätze 2–3 schwanken von Monat zu Monat stark)

## Quiz
- Fragetypen: **Bild → Name**, **Beschreibung → Item** (Item-Name im Text geschwärzt),
  **Zahlen** (Cooldown, Kosten, Tier), **Build-Pfad** („In welches Item upgradet X?“ / „Auf welchem Item baut X auf?“),
  **Counter: Hero → Item** („Welches Item wird gegen X besonders oft gekauft?“, mit Hero-Porträt) und
  **Counter: Item → Hero** („Gegen welchen Hero wird Y besonders oft gekauft?“, Antworten mit Hero-Icons)
  - Counter-Fragen nur zu klaren Countern (≥ 1,3×); falsche Antworten sind Items/Heroes ohne Counter-Verhältnis
    (≤ 1,0×), bevorzugt solche, die woanders Counter sind; Auflösung zeigt alle klaren Counter mit Faktor
  - Kosten folgen direkt aus dem Tier → Cooldown-Fragen kommen so oft wie Kosten- und Tier-Fragen zusammen
- Multiple Choice mit 4 Antworten; falsche Antworten bevorzugt **ähnlich** (gleiche Kategorie/Tier, ähnliche Kosten),
  nie eine zweite richtige Antwort (z. B. anderes gültiges Upgrade, identischer Effekttext)
- Runden à 10 Fragen, Typen gemischt, jedes Item höchstens einmal pro Runde
- Punkte: **100 pro richtiger Antwort + bis zu 50 Zeitbonus** (linear fallend über 15 s); Highscore wird gespeichert
- Nach jeder Frage Auflösung mit Item-Infos; am Ende Liste **„Zum Merken“** mit allen Fehlern
- Fragetypen in den Einstellungen wählbar; der Kategorie-Filter gilt auch fürs Quiz
- Tastatur (Desktop): 1–4 antworten, Enter weiter, Esc beenden

## Shop (Nachschlagen)
- Feld **„Shop“** auf der Startseite; reines Nachschlagewerk (kein Build-Planer)
- Aufbau wie ingame: Tabs **Weapon / Vitality / Spirit**, darunter **Tier 1–4 mit Preis**,
  Items als **Icon-Raster mit Namen**, innerhalb eines Tiers **alphabetisch** (die API liefert keine Ingame-Position)
- Im Raster markiert: nur **Aktiv-Items**
- Zeigt immer alle Items (der Kategorie-Filter gilt nur fürs Lernen/Quiz)
- **Suche** nach Name **und** deutschem Effekttext/Stat-Namen, über alle Kategorien, Umlaute optional
- Antippen öffnet eine **eigene Detailseite** (Tab und Scrollposition bleiben beim Zurück erhalten):
  - Inhalt der Kartenrückseite, **Build-Pfad antippbar** (springt zum Item)
  - **Lernstand** (Neu / Wird gelernt / Gelernt / Vorgemerkt + nächste Wiederholung)
  - **„Jetzt lernen“**: Item wird sofort fällig und kommt in die nächste Session; zählt nicht gegen
    das Neu-Limit, Lernverlauf bleibt, gilt auch für ausgeblendete Kategorien
  - **Broker (Corrupted)** bei Tier 3/4: Preis, verbesserte Werte (statt …, fest/±15 % je Match)
    und alle möglichen Nachteile (ohne ausgeschlossene und solche, die das Item selbst liefert)
- Navigation über den Browser-Verlauf: **Zurück (auch Android-Geste)** führt überall einen Schritt zurück

## Hero erraten
- Bildquellen: offizielle Assets und **eigene Ingame-Screenshots** (Screenshots folgen als eigener Schritt)
- Offizielle Bilder: die drei **freigestellten Kartenposen** je Hero (normal, critical, gloat) – zufällig gewählt,
  damit man nicht nur das Bild der Lernkarte wiedererkennt
- Varianten (in den Einstellungen wählbar), je **3 Aufdeck-Stufen**:
  - **Silhouette** (schwarz auf hellem Grund) → dunkel mit Details → halbhell → Original
  - **Zoom-Ausschnitt** (3,4× auf Gesicht/Oberkörper) → 2,3× → 1,5× → ganzes Bild
  - **Unscharf → scharf** (Weichzeichner 22 → 12 → 5 px → scharf)
  - **Fähigkeit → Hero**: erst 1 Ability-Icon, pro Stufe eins mehr, auf der letzten Stufe mit Namen
- Antwort: **Hero-Raster** (alle 42 Köpfe mit Namen); **Joker** reduziert auf **4 Antworten** (ohne schon falsch getippte)
- Punkte je Hero: Start 100, Aufdecken −20, Joker halbiert, falscher Tipp −15 (nie unter 0); **Auflösen** = 0
- Runden à 10 Heroes mit Highscore; am Ende Übersicht aller Heroes der Runde (Variante, Punkte, Fehlversuche)
- Eigene Screenshots:
  - In der App hochladen und Hero zuordnen (nur lokal in IndexedDB)
  - Im Repo unter `public/screenshots/<hero>/…` ablegen (per Deploy auf allen Geräten)
  - Export/Import, um App-Screenshots ins Repo zu übernehmen
  - **Nur eigene Screenshots ins Repo, keine YouTube-Frames** (das Repo ist öffentlich)

## Build-Quiz
- Eigenes Feld „Build-Quiz“ auf der Startseite: alle Items eines Hero-Builds an ihren **Icons** erkennen
- Zwei Arten von Builds, umschaltbar oben im Modus **„Typisch | Community“** (letzte Wahl wird gemerkt):
  - **Typisch**: die **16 meistgekauften Items** des Heroes ab Orakel (letzte 30 Tage), nach ⌀ Kaufzeit in
    **Früh** (bis 10 min), **Mitte** (10–20 min) und **Spät** (ab 20 min), innerhalb in Kaufreihenfolge
  - **Community**: der Build, der in Matches ab Orakel **am häufigsten gespielt** wird – nur seine **Pflicht-Abschnitte**
    (optionale weggelassen; meist 11–28 Items, Ausreißer auf die ersten 30 gekürzt), mit den Abschnittsnamen des Builds (Platzhalter wie `#Citadel_HeroBuilds_EarlyGame`
    → „Früh“); Kopfzeile mit Build-Name, Anteil der ausgewerteten Matches und letzter Änderung
  - Items, die es nicht mehr gibt, werden übersprungen; der Kategorie-Filter gilt hier nicht (sonst fehlen Teile des Builds)
- Hero: **zufällig** oder aus dem **Hero-Raster** wählen; am Ende „Nochmal“ (gleicher Hero) oder „Anderer Hero“
- Ablauf **Icon für Icon**: ein Icon ist markiert, darunter alle Namen als Knöpfe
  - Namen = Items des Builds + **6 Extra-Namen** (ähnliche Items, die nicht im Build sind)
  - **Sofort geprüft**: richtig → grün, Name verschwindet, nächstes Icon; falsch → rot, zählt als Fehlversuch, nochmal
  - Ein anderes offenes Icon antippen = damit weitermachen
- Wertung: **Fehlversuche + Zeit** (erste Anzeige bis letzter richtiger Name); **Bestwert je Hero und Build-Art**
  (erst wenigste Fehler, dann schnellste Zeit), angezeigt im Hero-Raster
- Auswertung: ganzer Build mit markierten Fehlern („du: …“), Items antippbar (Detailseite); Knopf
  **„Fehler-Items lernen“** merkt sie für die nächste Item-Lernsession vor (wie „Jetzt lernen“)
- Daten: wöchentlich im Hintergrund nach den Counter-Daten (typisch: 2 Abfragen für alle Heroes; Community: je Hero
  2 Abfragen); fehlt ein Hero diesmal, bleibt sein alter Build. Offline nutzbar

## Fortschritt & Motivation
Ziel: täglich dranbleiben, Fortschritt sichtbar machen, Schwächen gezielt üben, mehr Tempo und Abwechslung.

### Souls & Rang (Etappe 1)
- Jede Lern-Aktion bringt **Souls** (◆), die Summe bestimmt den **Rang** – mit den echten Deadlock-Abzeichen aus
  der API (`/v1/assets/ranks`, deutsche Namen, Abzeichen mit Unterstufe; offline im Cache)
  - Start bei **Unwissender** (Obscurus), **Novize 1** ab 100 Souls (nach der ersten kleinen Session),
    dann 65 Stufen bis **Ewiger 6** (Eternus) – erst schnell, später langsamer: bei täglichem Lernen etwa **6 Monate**
- Souls (alle Werte ganzzahlig):
  - Karteikarte bewertet: **+10**, egal ob gewusst oder nicht (sonst lohnt Schummeln beim Wischen) –
    je Karte einmal pro Tag (wie beim Tagesziel)
  - **Tagesziel erreicht: +100** (einmal pro Tag)
  - Quiz: Punkte ÷ 10 · Hero erraten: Punkte ÷ 10 · Build-Quiz: +5 je Item, +50 ohne Fehler
  - Je Modus und Tag bringen die **ersten 3 Runden** volle Souls, ab der 4. nur noch **¼**
- **Rang-Verfall**: ab dem **6. Tag ohne Lernen −50 Souls pro Tag** (nie unter 0); ab dem 4. Tag warnt die
  Startseite; als Lerntag zählt jede Aktivität, die Souls bringt. Abgerechnet werden nur vergangene Tage
- Souls werden als **Verlauf** gespeichert (Datum, Menge, Grund) – für die Statistik und die Rundenregel

### Tagesmissionen & Streak (Etappe 1)
- **3 Tagesmissionen** pro Tag, fest ausgelost (gleiche Missionen den ganzen Tag), in ~10–15 Minuten machbar:
  eine Lern-Mission (z. B. „10 Fähigkeiten-Karten lernen“, „5 neue Karten lernen“) und zwei Spiel-Missionen
  („Quiz mit mind. 7 richtig“, „Hero erraten mit mind. 600 Punkten“, „Build-Quiz ohne Fehler“) – nur aus Modi,
  für die Daten da sind; je **+100 ◆**, alle drei **+150 ◆ Bonus**
- **Streak-Schutz**: alle 7 Streak-Tage einer (höchstens 2). Ein verpasster Tag (Tagesziel nicht erreicht) verbraucht
  einen, statt den Streak zu beenden. Wird aus der Tageshistorie berechnet (auch nach Import korrekt)

### Startseite & Effekte (Etappe 1)
- Oben die **Rang-Karte** (Abzeichen, Rang, Souls, Fortschritt bis zur nächsten Stufe, Streak + Schutz, Verfall-Hinweis),
  darunter **Tagesmissionen** mit Tagesziel, dann die **Karteikarten**, dann alle Spielmodi als **Kacheln** mit Highscore
- **Effekte** (in den Einstellungen abschaltbar, ohne Ton): „+10 ◆“ fliegt kurz hoch, **Aufstieg** mit Abzeichen und
  Konfetti, kurze **Vibration bei Fehlern** in Quiz, Hero erraten und Build-Quiz (nicht bei „nicht gewusst“ –
  ehrliches Bewerten soll sich nicht schlecht anfühlen)

### Schwächen-Training (Etappe 2)
- Fehler aus allen Modi werden gesammelt („nicht gewusst“, falsche Quiz-Antworten, Fehltipps beim Hero erraten,
  Fehler im Build-Quiz); Knopf **„Schwächen üben“**: bis zu 15 Karten aus allen Decks mit den meisten Fehlern der
  letzten 14 Tage; „gewusst“ im Training behebt die Schwäche, nach 14 Tagen verfallen Fehler

### Sammelalbum, Hero-Meisterschaft, Statistik (Etappe 3)
- **Sammelalbum im Shop**: Rahmen **Bronze** (gelernt), **Silber** (nächste Wiederholung in ≥ 3 Wochen),
  **Gold** (≥ 2 Monate); „x/58 gemeistert“ je Kategorie
- **Hero-Meisterschaft**: 5 Sterne – Hero-Karte mind. Silber · alle 4 Fähigkeiten-Karten mind. Silber ·
  Counter-Karte mind. Silber · Build-Quiz (Typisch) ohne Fehler · Hero erraten einmal ohne Aufdecken, Joker und Fehltipp
- **Statistik-Seite** (über die Rang-Karte): Kalender der Lerntage, Souls-Verlauf, gelernte/gemeisterte Karten je Deck
- **Meilenstein-Souls**: Karte erstmals Silber +25, erstmals Gold +50, neuer Hero-Stern +100

### Sprint & Überleben (Etappe 4)
- **60-Sekunden-Sprint**: Items, Fähigkeiten und Heroes am Bild erkennen (4 Antworten), umschaltbar auf eine Sorte;
  falsch kostet 3 s; Highscore je Auswahl
- **Überleben**: 3 Leben, alle Quiz-Fragetypen gemischt; 15 s pro Frage, alle 5 Fragen 1 s weniger (bis 6 s);
  Zeit abgelaufen = Leben weg; Highscore = überlebte Fragen

## Daten & Fortschritt
- Fortschritt, Einstellungen, Highscores, Build-Quiz-Bestwerte, Souls-Verlauf und Screenshots: lokal in IndexedDB
- **Export/Import** als JSON-Datei (Backup / Gerätewechsel)

## Reihenfolge
1. ✅ **MVP:** Item-Karten + SRS + Offline + Export/Import + Deploy
2. ✅ Quiz
3. ✅ Shop (Nachschlagen)
4. ✅ Hero-Decks (Fähigkeiten, Heroes)
5. ✅ Hero erraten (offizielle Assets)
6. Eigene Screenshots – vorerst übersprungen
7. ✅ Patch-Erkennung (Reset + Badge + vorher → nachher)
8. ✅ Counter-Deck + Counter-Quiz (Statistik der Deadlock-API)
9. ✅ Build-Quiz (typische und Community-Builds)
10. Fortschritt & Motivation in 4 Etappen:
    1. ✅ Souls & Rang, Tagesmissionen, Streak-Schutz, Rang-Verfall, neue Startseite, Effekte
    2. Schwächen-Training
    3. Sammelalbum, Hero-Meisterschaft, Statistik, Meilenstein-Souls
    4. Sprint, Überleben

## Offene Punkte / Risiken
- Wo die API keine deutschen Texte liefert, wird auf Englisch zurückgefallen.
- AP-Kosten der Ability-Upgrades (1/2/5) sind Spielwissen, nicht aus der API.
- Counter zeigen, was Spieler ab Orakel gegen einen Hero **kaufen** – kein Beweis, dass es hilft. Bei Heroes ohne
  klaren Counter (Top-Faktor unter 1,3×) sind die Top 3 nur leicht über dem Durchschnitt.
- Broker: Die API liefert aktuell keine Corrupted-Preise (alle 0) – die Preiszeile entfällt dann.
- Bilder vom CDN werden als „opaque“ gecacht, falls das CDN kein CORS sendet; Chrome rechnet
  diese mit Puffer aufs Speicherkontingent an. Bei Problemen: Bilder als Blobs in IndexedDB speichern.
