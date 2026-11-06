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
- **Alles lernen**: oberste Zeile im Feld „Karteikarten“ (ab zwei Decks mit Karten), eine Session über alle Decks
  - erst alle fälligen Karten (beide Richtungen, älteste zuerst – über die Decks hinweg), dann die neuen jedes Decks
    bis zu seinem Limit, **abwechselnd aus den Decks** (so kommt jedes Deck voran, auch wenn man früh aufhört),
    dann die neuen Rückrichtungs-Karten ebenso
  - die Lernen-Knöpfe der einzelnen Decks bleiben (dann nicht mehr hervorgehoben); Antwort eintippen gilt je Karte
    nach ihrem Deck
- **Neue Karten erst kennenlernen** (Einstellung, standardmäßig an): beim ersten Mal nicht bewerten, sondern
  kennenlernen – vorne „Neue Karte“, antippen dreht um, dann **„Weiter“** statt „gewusst/nicht gewusst“ (Wischen in
  beide Richtungen und Enter gehen auch); kein Eintippen beim Kennenlernen
  - die **erste Abfrage** kommt nach 3 anderen Karten in derselben Session (wie bei „nicht gewusst“), ganz normal
    mit Bewertung – erst sie zählt fürs Lernsystem; ist die Karte die letzte, wird sie beim nächsten Mal abgefragt
  - Abgebrochen nach dem Kennenlernen: Die Karte kommt beim nächsten Mal direkt als Abfrage (zählt als fällig)
  - Tagesziel, +10 Souls und Neu-Limit zählen schon beim Kennenlernen (die Abfrage am selben Tag nicht noch einmal)
  - „gelernt“ (Bronze im Album, „Gelerntes zuerst“) erst nach der ersten Abfrage
  - Rückrichtungs-Karten werden gleich abgefragt (der Inhalt ist von der normalen Karte bekannt)
  - gilt überall, wo neue Karten vorkommen: Decks, „Alles lernen“, „+10 neue“, Vormerkungen, „Schwächen üben“
  - aus: neue Karten werden wie früher sofort bewertet
- **Schwächen beim Lernen**: „nicht gewusst“ zählt nur bei Karten, die die Lernphase schon einmal geschafft haben
  (wie bei „hartnäckig“) – Vergessen kurz nach dem Kennenlernen ist normal und zählt nicht

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
  - Quiz: Punkte ÷ 10 · Hero erraten: Punkte ÷ 10 · Build-Quiz: +5 je Item, +50 ohne Fehler ·
    Sprint: +5 je richtige Antwort · Überleben: +10 je überlebte Frage
  - Je Modus und Tag bringen die **ersten 3 Runden** volle Souls, ab der 4. nur noch **¼**
- **Rang-Verfall**: ab dem **6. Tag ohne Lernen −50 Souls pro Tag** (nie unter 0); ab dem 4. Tag warnt die
  Startseite; als Lerntag zählt jede Aktivität, die Souls bringt. Abgerechnet werden nur vergangene Tage
- Souls werden als **Verlauf** gespeichert (Datum, Menge, Grund) – für die Statistik und die Rundenregel

### Tagesmissionen & Streak (Etappe 1)
- **3 Tagesmissionen** pro Tag, fest ausgelost (gleiche Missionen den ganzen Tag), in ~10–15 Minuten machbar:
  eine Lern-Mission (z. B. „10 Fähigkeiten-Karten lernen“, „5 neue Karten lernen“) und zwei Spiel-Missionen
  („Quiz mit mind. 7 richtig“, „Hero erraten mit mind. 600 Punkten“, „Build-Quiz ohne Fehler“, ab Etappe 4 auch
  Sprint und Überleben) – nur aus Modi,
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
- Fehler aus allen Modi werden gesammelt (je Karte, mit Quelle und Datum):
  - Karteikarten: „nicht gewusst“ – seit dem Kennenlernen nur bei Karten, die die Lernphase schon geschafft haben
  - Quiz: jede falsche Antwort – zählt fürs Item, bei Counter-Fragen für die **Counter-Karte** des Heroes
  - Hero erraten: Hero mit Fehltipp oder „aufgelöst“ (einmal je Frage) → Hero-Karte
  - Build-Quiz: erster Fehlversuch je Icon → Item
  - Sprint: falsche Antwort → Item-, Fähigkeiten- bzw. Hero-Karte · Überleben: falsch oder Zeit abgelaufen (wie im Quiz)
- Startseite: Zeile **„Schwächen“** unter den Decks mit Anzahl und Knopf **„Schwächen üben (n)“**
- Übersicht: die bis zu **15 Karten** mit den meisten Fehlern der letzten **14 Tage** (bei Gleichstand die jüngsten),
  mit Bild, Häufigkeit und Quelle; nur Karten, die es noch gibt
- **Training**: die Karten als Lernsession aus allen Decks (Karteikarten wie gewohnt, Item-Links antippbar);
  bewertet normal (FSRS, Souls, Tagesziel); **„gewusst“ im Training behebt die Schwäche** – normales Lernen nicht;
  am Ende „x von y Schwächen behoben“
- Fehler älter als 14 Tage verfallen (beim Start aufgeräumt); im Backup enthalten
- Neue Tagesmission **„5 Schwächen-Karten üben“** (sobald es mind. 5 Schwächen gibt)

### Sammelalbum, Hero-Meisterschaft, Statistik (Etappe 3)
- **Stufe einer Karte** aus dem Abstand, den das Lernsystem bei der letzten Wiederholung gewählt hat („Jetzt lernen“
  und Patch-Fälligkeit ändern ihn nicht): **Bronze** = gelernt, **Silber** = nächste Wiederholung in ≥ 3 Wochen,
  **Gold** = in ≥ 2 Monaten („gemeistert“). Eine vergessene Karte verliert ihre Stufe wieder
- **Sammelalbum im Shop**: Item-Kacheln mit Rahmen und Medaille (🥉🥈🥇) nach Stufe; je Kategorie „x/y gemeistert“
  (Gold) mit Balken und Anzahl je Stufe; die Detailseite zeigt die Stufe und was zur nächsten fehlt
- **Hero-Meisterschaft** (Kachel „Heroes“ auf der Startseite): Raster aller Heroes mit Sternen, je Hero 5 –
  Hero-Karte mind. Silber · alle 4 Fähigkeiten-Karten mind. Silber · Counter-Karte mind. Silber · Build-Quiz
  (Typisch) ohne Fehler (Bestwert) · Hero erraten einmal ohne Aufdecken, Joker und Fehltipp
  - Die Sterne der Karten zeigen den aktuellen Stand (Karte vergessen → Stern weg, bis sie wieder sitzt)
  - Hero-Seite: Stand je Stern (Fähigkeiten einzeln mit Stufe) und „Neue Karten von … lernen“ – merkt die noch nie
    gelernten Karten des Heroes für die nächste Session ihres Decks vor
- **Statistik-Seite** (Rang-Karte antippen oder Kachel „Statistik“):
  - Kennzahlen: Streak (und längster), Lerntage, Bewertungen, Hero-Sterne
  - **Kalender der Lerntage**: 20 Wochen wie bei GitHub – gelernt / Tagesziel / doppeltes Tagesziel, verbrauchter
    Streak-Schutz markiert; Tag antippen zeigt die Details; auch als Liste
  - **Souls-Verlauf**: Stand am Ende jedes Tages seit dem ersten Eintrag; antippen/überfahren zeigt Tag, Stand und
    Änderung; auch als Tabelle
  - **Karten je Deck**: gelernt und gemeistert, Balken nach Stufe
- **Meilenstein-Souls**: Karte erstmals Silber +25, erstmals Gold +50 (direkt Gold: beides), jeder neue Hero-Stern +100 –
  jeweils nur einmal, auch wenn eine Karte vergessen und wieder gefestigt wird
  - Einblendung „🥈 Silber +25 ◆“ bzw. „★ Haze +100 ◆“, am Ende der Lern-Session bzw. Runde zusammengefasst
  - Bisheriger Fortschritt wird beim ersten Start einmalig still gutgeschrieben (zählt nicht als Lerntag für den
    Rang-Verfall); im Backup enthalten
- Farben: eine Bernstein-Reihe (heller = mehr) für Stufen und Kalender, Medaillen bzw. Beschriftung als zweites Merkmal

### Sprint & Überleben (Etappe 4)
- **60-Sekunden-Sprint**: Items, Fähigkeiten und Heroes am Bild erkennen (4 Antworten), umschaltbar auf eine Sorte
  (Alle / Items / Fähigkeiten / Heroes; bei „Alle“ kommt jede Sorte gleich oft)
  - Items: Bild → Name (falsche Antworten ähnlich: Kategorie, Tier, Kosten) · Fähigkeiten: Icon → Name (falsche
    bevorzugt von gleicher Art: Ultimate oder nicht), Auflösung mit Hero · Heroes: zufällige Kartenpose → Name
  - falsch kostet **3 s** („−3 s“), die richtige Antwort wird kurz gezeigt; jede Karte erst wieder, wenn alle ihrer
    Sorte dran waren; Item-Kategorien wie im Quiz
  - Highscore = richtige Antworten, **je Auswahl**; Ergebnis mit „Vertan bei“ und „Fehler lernen“
- **Überleben**: 3 Leben, Quiz-Fragetypen gemischt (Auswahl und Kategorien wie im Quiz); 15 s pro Frage, alle
  5 Fragen 1 s weniger (bis 6 s); falsch oder Zeit abgelaufen = Leben weg
  - richtig: kurz grün, dann von selbst weiter · falsch: Auflösung wie im Quiz, dann „Weiter“
  - Highscore = überlebte Fragen; Ergebnis mit „Zum Merken“
- In beiden Modi steht die Uhr, solange die App im Hintergrund ist (Anruf, App gewechselt)
- Souls mit Rundenregel (siehe oben), Fehler zählen als Schwächen, Highscores im Backup
- Neue Tagesmissionen: „60-Sekunden-Sprint mit mindestens 15 richtigen“, „Überleben: mindestens 10 Fragen“
- Startseite: **Spielen** (Quiz, Sprint, Überleben, Hero erraten, Build-Quiz) und **Nachschlagen & Fortschritt**
  (Shop, Heroes, Statistik)
- Offline: alle Hero-Posen werden mit vorgeladen (auch für Hero erraten)

### Lane-Angriff (Tagesmissionen)
Zusätzlicher Ansporn für die Tagesmissionen: Jeden Tag greifst du auf einer Lane an.
- **Lane und Gegner** fest pro Tag ausgelost (wie die Missionen, gleich auf allen Geräten): Lane Gelb, Blau oder Grün,
  Gegner ist der Patron **Hidden King** oder **Archmother**. Auf der Map wird immer die obere Basis angegriffen – nur
  der Name wechselt (welcher Patron in welcher Basis steht, spielt hier keine Rolle)
- **Ziele** nacheinander: **Guardian → Walker → Patron**. Jede geschaffte Mission zerstört das vorderste Ziel – in der
  Reihenfolge, in der du die Missionen schaffst, egal welche: die erste geschaffte den Guardian, die zweite den Walker,
  die dritte den Patron
- **Schaden**: Das vorderste Ziel verliert so viel Leben, wie die am weitesten fortgeschrittene offene Mission geschafft
  ist – Lern-Missionen je Karte, Spiel-Missionen nach dem besten Rundenergebnis (5 von 7 richtigen = 71 %). Fällt es,
  zeigt das nächste Ziel gleich den Stand der nächstbesten Mission. Leben wird aufgerundet (1 % bis zum Fall)
- **Startseite**: im Feld „Heute“ unter dem Tagesziel eine Leiste in Lane-Farbe – Guardian, Walker, Patron mit
  Lebensbalken –, darunter die Missionen wie bisher; nur, wenn es drei Missionen gibt
  - Antippen öffnet die **Lane-Map**: die Map mit der Lane des Tages und den drei Zielen (zerstörte durchgestrichen, das
    nächste hervorgehoben), je Ziel das Leben bzw. welche Mission es zerstört hat, dazu die Bilanz
- **Effekte** (abschaltbar wie die anderen): in Lern-Sessions und Spielen kurz „⚔ Guardian −20 %“, „💥 Guardian
  zerstört!“ bzw. „🏆 Sieg gegen Hidden King!“ (oben bei „+10 ◆“); auf der Startseite laufen die Lebensbalken seit dem
  letzten Blick darauf sichtbar herunter, mit „zerstört!“ und am Ende **„Sieg!“ mit Konfetti**
- **Sieg**: Patron zerstört, also alle drei Missionen geschafft. Die Souls bleiben wie bisher (+100 je Mission, +150 für
  alle drei)
- **Niederlage**: Ist der Patron bis Mitternacht nicht gefallen, zählt der Tag als Niederlage; am nächsten Tag gibt es eine
  neue Lane. Tage, an denen weder gelernt noch gespielt wurde, zählen gar nicht (nur die App öffnen, z. B. für den Shop,
  ist keine Niederlage)
- **Statistik**: Siege, Niederlagen, Siegesserie (und die beste), dazu je Patron; Tage, die nicht zählen, unterbrechen die
  Serie nicht
- Siege und Niederlagen ergeben sich aus dem Souls-Verlauf (der Bonus für alle drei Missionen = Sieg) – so sind sie im
  Backup und mit „Fortschritt löschen“ weg. Gezählt wird ab dem ersten Tag mit Lane-Angriff (der Tag ist im Backup)

## Lernen vertiefen
Ziel: mehr Wissen abfragen (Upgrades, Item-Effekte) und Gelerntes besser behalten.

### Neue Quiz-Fragen, Items nach Beliebtheit (Etappe A)
- Neuer Fragetyp **Fähigkeiten-Upgrades** (in Quiz und Überleben, in den Einstellungen abwählbar):
  „Was macht das 5-AP-Upgrade von Sleep Dagger?“ – 4 Upgrade-Texte; falsch: die beiden anderen Stufen derselben
  Fähigkeit und ein Upgrade einer anderen Fähigkeit des Heroes
  - Fähigkeiten mit gelernter Karte kommen bevorzugt dran (meist), ab und zu auch andere – so bei „Alles“; sonst
    gilt die Einstellung „Gefragt wird“ (siehe „Gelerntes zuerst“)
  - Auflösung: alle drei Upgrades der Fähigkeit; ein Fehler zählt als Schwäche der Fähigkeiten-Karte
- Neuer Fragetyp **Item-Effekte** (aus den Item-Werten), zwei Varianten:
  - **Effekt → Item**: „Welches Item bringt „Kugellebensraub“?“ – genau eine Antwort hat den Effekt; nur
    seltene, eindeutige Effekte (höchstens 8 Items), allgemeine wie „Schaden“ oder „Radius“ fallen weg
  - **Wer gibt am meisten?**: „Welches Item bringt am meisten „Bonuslebenspunkte“?“ – alle 4 Antworten haben
    den Effekt; nur vergleichbare Werte (gleiche Einheit, ohne Bedingung) mit eindeutigem Höchstwert;
    die Auflösung zeigt alle 4 Werte
- **Items nach Beliebtheit**: neue Item-Karten kommen meistgekauft zuerst (Käufe in Matches ab Orakel,
  letzte 30 Tage – aus derselben Abfrage wie die Counter-Daten, wöchentlich); ohne Statistik wie bisher nach Tier.
  Neue Items aus einem Patch kommen weiterhin vor allen anderen

### Hartnäckige Karten & Merkhilfen (Etappe B)
- Eine Karte ist **hartnäckig**, wenn sie nach dem Lernen **4× vergessen** wurde (gezählt vom Lernsystem: „nicht
  gewusst“ bei einer schon gelernten Karte)
- Hartnäckige Karten stehen zusätzlich in **„Schwächen üben“** (höchstens 10 über die 15 häufigsten Schwächen hinaus),
  bis sie wieder sitzen (Silber); die Startseite zeigt „n hartnäckig“
- **Übersicht** aller hartnäckigen Karten mit ihren Merkhilfen auf der Statistik-Seite
- **Merkhilfe** für jede Karte: „+ Merkhilfe“ auf der Kartenrückseite und der Detailseite; die eigene Notiz steht
  danach bei jeder Wiederholung oben auf der Rückseite (vorne würde sie die Antwort verraten); bei hartnäckigen Karten
  hervorgehoben („Diese Karte hast du schon 5× vergessen …“)
  - in der Lernsession als Fenster über der Karte (Zurück schließt nur das Fenster), sonst direkt auf der Seite
  - bis 300 Zeichen; leer speichern löscht; im Backup, bleiben beim Löschen des Fortschritts erhalten

### Eintippen & Rückrichtung (Etappe C)
- **Antwort eintippen** bei Items und Counter, je Deck in den Einstellungen einschaltbar: statt „Tippen zum
  Umdrehen“ ein Eingabefeld
  - kleine Tippfehler und ein eindeutiger Anfang (ab 4 Buchstaben) zählen als richtig; keine Vorschlagsliste
  - Counter: eins der Top-3-Items reicht; die Rückseite markiert es
  - nach dem Umdrehen ist „Gewusst“ bzw. „Nicht gewusst“ vorgewählt – ein Tipp (oder Enter) bestätigt, umentscheiden
    geht; „Weiß nicht“ dreht ohne Eingabe um; oben auf der Rückseite steht das Ergebnis („✓ Richtig“ bzw. „Du: … ·
    richtig: …“)
- **Rückrichtung** bei Items, Fähigkeiten und Heroes: vorne nur der Name („Was macht Headhunter?“), hinten Bild
  und Wirkung
  - eigene Karten mit eigenem Wiederholungsplan, erst wenn die normale Karte gelernt ist (die Lernphase einmal
    geschafft hat – nicht schon direkt nach der ersten Bewertung)
  - zusätzlich bis zu **5 neue Rückrichtungs-Karten** pro Tag und Deck (das normale Neu-Limit bleibt)
  - Sammelalbum und Sterne zählen nur die normale Karte; die Rückrichtung bringt Souls (auch Meilensteine),
    zählt fürs Tagesziel und in der Statistik („n rückwärts“ je Deck)
  - Startseite: fällige und neue Rückrichtungs-Karten zählen bei „fällig“ und „neu“ mit; die Merkhilfe gilt für
    beide Richtungen; ein Patch macht auch die Rückrichtung gelernter Karten fällig

### Gelerntes zuerst (einstellbar)
Wer gerade erst anfängt, soll im Quiz nicht nur raten. Einstellung **„Gefragt wird“** (Einstellungen → Spielen) für
Quiz, Überleben, Sprint und Hero erraten; „gelernt“ heißt: im Lernmodus mindestens einmal bewertet (ab Bronze).
Item-Fragen gehören zur Item-Karte, Counter-Fragen zur Counter-Karte des Heroes, Upgrade-Fragen zur Fähigkeit,
Hero erraten zur Hero-Karte. Die falschen Antworten kommen immer aus allen Karten.
- **Gelerntes zuerst** (Standard): erst Fragen zu gelernten Karten; reicht das nicht für eine volle Runde, wird mit
  neuen aufgefüllt
  - neue Fragen sind mit **„Neu“** markiert (an der Frage, im Sprint und bei Hero erraten auf dem Bild, in den
    Fehlerlisten); unter der Frage: „Neu: noch nicht gelernt – ein Fehler zählt nicht als Schwäche“
  - ein Fehler dort zählt **nicht als Schwäche** (steht aber unter „Zum Merken“; „Fehler lernen“ im Sprint merkt
    sie trotzdem vor)
  - Sprint: erst die gelernten Karten einer Sorte, dann die anderen
- **Nur Gelerntes**: keine neuen Fragen; Quiz- und Hero-Runden werden am Anfang kürzer, ohne gelernte Karten gibt es
  einen Hinweis („Noch nichts gelernt“ mit Verweis auf die Einstellung)
  - Sprint (je Sorte) und Überleben brauchen mindestens **10** gelernte Karten, sonst kämen ständig dieselben;
    vorher steht auf der Startseite, wie viele fehlen
  - Tagesmissionen, die so nicht zu schaffen wären (Quiz, Hero erraten, Sprint, Überleben mit weniger als
    10 gelernten Karten), werden an dem Tag nicht ausgelost
- **Alles**: wie vorher – alle Karten, ohne Markierung, jeder Fehler zählt als Schwäche (Upgrade-Fragen bevorzugen
  weiter gelernte Fähigkeiten)
- Startseiten von Sprint und Überleben nennen die Einstellung („Gefragt wird: …“)

## Map-Wissen
Ziel: wissen, wo auf der Map was ist. Daten aus der API (`/v1/assets/map`): Minimap und Positionen der Objekte
(relativ zur Karte); geladen mit dem normalen Sync, offline gespeichert (Minimap im Bild-Cache).
- Objekte in **Bereichen** (englische Namen wie ingame, dazu ein Satz auf Deutsch – wo unsicher, nur der Name):
  - **Lanes & Ziele**: Lanes Gelb (links), Blau (Mitte), Grün (rechts) – Farbe aus den Ziplines der API –,
    Guardian, Walker, Patron je Lane/Basis; **Mid Boss** von Hand in der Kartenmitte (fehlt in der API)
  - **Camps & Vaults**: kleine, mittlere, große Camps, Sinner's Sacrifice
  - **Orientierung**: Lane-Shops, Basis-Shop, Secret Shops, Teleporter (mit Ziel), Urne (Spawn, Abgabe), Brücken-Buffs
  - **Bewegung**: Ziplines (als Linien in Lane-Farbe), Kletterseile, Sprungpads, Dampfdüsen, Veils
  - **Kisten & Statuen** (nur auf der Map-Seite): Kisten, harte Kisten, goldene Statuen, Heil-Pickups
  - nicht übernommen: „Base Sentries“ und „Cores“ der API (keinem Spielobjekt sicher zuzuordnen), Glocken, Rifts
  - Die Ziele (Guardians, Walker, Patron) liegen in der API um 5 % nach links oben verschoben (Schwerpunkt bei 0,45
    statt in der Kartenmitte, alle anderen Objekte sind punktsymmetrisch zur Mitte). Die App schiebt sie so, dass ihr
    Schwerpunkt in der Mitte liegt – dann sitzen sie auf ihren Lanes; ist die API korrigiert, verschiebt sich nichts.
    Ändert sich die Aufbereitung, lädt die App die gespeicherte Map beim nächsten Start mit Netz neu
- **Map-Seite** (Nachschlagen): Ebenen je Bereich ein/aus (Kisten & Statuen standardmäßig aus); Antippen eines
  Symbols zeigt Name, Erklärung und Anzahl und hebt alle gleichen hervor; Legende mit den Symbolen der gewählten
  Ebenen (antippbar); Lupe vergrößert, dann mit dem Finger verschieben
- **Map-Quiz** (Spielen): Runden à 10 Fragen, Punkte wie im Quiz (100 + bis 50 Zeitbonus), Highscore
  - **Wo ist …?**: auf die Map tippen – richtig, wenn der Tipp höchstens etwa einen Fingerbreit (5 % der Kartenbreite)
    neben einem passenden Objekt liegt; danach zeigt die Map alle passenden Stellen und den Tipp. Nur für Objekte,
    die es höchstens 20-mal gibt
  - **Was ist hier?**: eine Stelle ist markiert, 4 Antworten (falsche bevorzugt aus demselben Bereich, nie eine Art,
    die ebenfalls an dieser Stelle liegt – z. B. Urnen-Spawn und -Abgabe)
  - beide Seiten zählen gleich (die Map steht immer gleich herum); die Lanes sind immer zu sehen
  - jede Objektart möglichst nur einmal pro Runde – bei wenigen gewählten Bereichen auch öfter, nie direkt hintereinander
  - Souls nach Rundenregel (Punkte ÷ 10), Tagesmission „Map-Quiz mit mindestens 7 richtigen Antworten“
  - Ergebnis mit „Zum Merken“ und „Auf der Map zeigen“; Fehler zählen nicht als Schwächen (keine Lernkarten)
  - Einstellungen: Bereiche (Lanes & Ziele, Camps & Vaults, Orientierung, Bewegung) und die beiden Fragetypen
    abwählbar; „Gefragt wird“ gilt hier nicht

## Daten & Fortschritt
- Fortschritt, Einstellungen, Highscores, Build-Quiz-Bestwerte, Souls-Verlauf, Meilensteine und Screenshots: lokal in IndexedDB
- **Export/Import** als JSON-Datei (Backup / Gerätewechsel)
  - auf dem Handy über das **Teilen-Menü** (Drive, Dateien, Mail …); Chrome teilt keine JSON-Dateien → dann als
    Textdatei (.txt), der Import liest beides; am Computer und mit „Als Datei herunterladen“ als Download
- **Dauerhafter Speicher**: Mit Fortschritt bittet die App den Browser um dauerhaften Speicher (ohne darf er bei
  Platzmangel löschen) – höchstens einmal am Tag, bis er zusagt (Firefox fragt nach, Chrome entscheidet selbst)
- Einstellungen → Backup: letztes Backup („heute“, „vor 5 Tagen“) und ob der Speicher dauerhaft ist
- **Backup-Erinnerung** auf der Startseite: noch nie gesichert → eine Woche nach dem ersten Lerntag; sonst zwei Wochen
  nach dem letzten Backup, wenn seitdem gelernt wurde
  - „Jetzt sichern“ sichert direkt (danach kurz „✓ Backup gesichert“), „Später“ blendet sie 3 Tage aus
  - abgebrochenes Teilen zählt nicht; ein eingespieltes Backup zählt als letztes Backup

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
10. ✅ Fortschritt & Motivation in 4 Etappen:
    1. ✅ Souls & Rang, Tagesmissionen, Streak-Schutz, Rang-Verfall, neue Startseite, Effekte
    2. ✅ Schwächen-Training
    3. ✅ Sammelalbum, Hero-Meisterschaft, Statistik, Meilenstein-Souls
    4. ✅ Sprint, Überleben
11. Lernen vertiefen in 3 Etappen:
    1. ✅ Neue Quiz-Fragen (Upgrades, Item-Effekte), Items nach Beliebtheit
    2. ✅ Hartnäckige Karten, Merkhilfen
    3. ✅ Eintippen, Rückrichtung
12. ✅ Gelerntes zuerst (einstellbar: Gelerntes zuerst / Nur Gelerntes / Alles)
13. ✅ Fortschritt absichern (dauerhafter Speicher, Backup-Erinnerung, Sichern übers Teilen-Menü), „Alles lernen“
14. ✅ Map-Wissen: Map-Seite (Ebenen, Antippen, Zoom) und Map-Quiz („Wo ist …?“, „Was ist hier?“)
15. ✅ Neue Karten erst kennenlernen (umdrehen, lesen, „Weiter“), erste Abfrage 3 Karten später
16. ✅ Lane-Angriff: Tagesmissionen zerstören Guardian → Walker → Patron, Siege und Niederlagen in der Statistik

## Offene Punkte / Risiken
- Wo die API keine deutschen Texte liefert, wird auf Englisch zurückgefallen.
- AP-Kosten der Ability-Upgrades (1/2/5) sind Spielwissen, nicht aus der API.
- Counter zeigen, was Spieler ab Orakel gegen einen Hero **kaufen** – kein Beweis, dass es hilft. Bei Heroes ohne
  klaren Counter (Top-Faktor unter 1,3×) sind die Top 3 nur leicht über dem Durchschnitt.
- Broker: Die API liefert aktuell keine Corrupted-Preise (alle 0) – die Preiszeile entfällt dann.
- Bilder vom CDN werden als „opaque“ gecacht, falls das CDN kein CORS sendet; Chrome rechnet
  diese mit Puffer aufs Speicherkontingent an. Bei Problemen: Bilder als Blobs in IndexedDB speichern.
