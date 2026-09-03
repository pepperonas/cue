# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.62.0] - 2026-09-03

### Changed
- **Speichern im Detail-Dialog schließt ihn jetzt** — wie beim Anlegen eines
  neuen Prompts. Bis hierher kehrte er zur Leseansicht zurück und verlangte ein
  zweites Schließen für nichts: die Karte dahinter trägt den neuen Text
  ohnehin schon.
- ⚠️ Der Speicherpfad läuft dafür über `onClose` und **nicht** über
  `onCancelEdit`: dort räumt der Aufrufer **beides** ab, offenen Dialog und
  Bearbeitungs-Markierung. Bliebe die Markierung stehen, öffnete derselbe
  Prompt beim nächsten Mal direkt im Formular — und weil die Markierung eine id
  ist, wäre das genau bei diesem einen Prompt so und sonst nirgends.

## [0.61.1] - 2026-09-01

### Fixed
- ⚠️ **Die Landing Page ließ sich auf dem Telefon seitwärts schieben** — gemessen
  96 px Überlauf bei 390, 126 bei 360 und 166 bei 320 px. Ursache: die Kopfzeile
  trug seit 0.61.0 zwei CTA-Knöpfe nebeneinander und bricht nicht um. Unter
  640 px zeigt sie jetzt nur noch Marke und Theme-Schalter; dieselben Knöpfe
  stehen unmittelbar darunter im Hero und noch einmal am Seitenende.

### Changed
- **Die Landing Page ist auf dem Telefon rund ein Viertel kürzer** (4758 → 3571 px
  bei 390 px Breite), ohne dass eine Aussage entfällt:
  - Der Hero füllte anderthalb Bildschirme, bevor die erste Aussage über die App
    kam. Logo 84 → 56 px, Überschrift 32 → 24 px mit Silbentrennung (deutsche
    Komposita brachen sonst falsch), engere Abstände.
  - ⚠️ **Die Desktop-Screenshots sind auf dem Telefon ausgeblendet.** Auf 358 px
    zusammengeschoben ist ein Desktop-Board nicht mehr zu entziffern, kostet aber
    je 230 px Scrollweg. Die Handy-Aufnahme bleibt — und die Demo ist einen
    Fingertipp entfernt, dort sieht man das Echte. Messbarer Nebeneffekt: **183
    statt rund 1200 kB** Bilddaten auf einer Mobilverbindung.
  - ⚠️ **Die zwölf Chips waren 44 px hoch, obwohl sie `pointer-events: none`
    tragen** — die Touch-Ziel-Regel griff auf Etiketten, die niemand antippen
    kann, und kostete 528 px Scrollweg für eine Aufzählung. Mit der Ausnahme und
    kürzeren Beschriftungen: 616 → 330 px.
- Chip-Beschriftungen gekürzt (auch am Desktop lesbarer): „CLI-Prompts
  mitschreiben", „In laufende Sessions tippen", „Kopieren & Duplizieren",
  „Import & Export", „Material-You-Farben", „Hell & Dunkel".

## [0.61.0] - 2026-09-01

### Added
- **Demo unter `/demo`** — die **echte** App auf erfundenen Daten im Speicher,
  ohne Anmeldung. Board, Liste und Detail sind vollständig bedienbar (anlegen,
  ziehen, bearbeiten, Tags, Priorität, Zusammenführen); Runs, Statistiken,
  Snippets und Verlauf zeigen vorbereitete Daten. Ein Streifen oben sagt, dass
  nichts gespeichert wird. Ein Besucher kann cue sonst nicht ausprobieren — die
  App ist mandantenfähig und ein neues Konto wartet auf Freischaltung.
- ⚠️ **Alles, was Geld kostet oder eine fremde Maschine anfasst**, sagt in der
  Demo ab: KI-Optimierung starten, Runs starten, in eine CLI-Sitzung tippen.
  Eine erfundene KI-Antwort wäre schlimmer als keine — sie sähe aus wie ein
  Ergebnis und wäre keines. Der vorbereitete Vorschlag darf man dagegen
  übernehmen oder verwerfen; das kostet nichts und ist der interessante Teil.
- **Landing Page ausgebaut**: acht Karten statt vier (neu: Ordnung/Tags,
  Live-Sync und Mobil, Auswertung, Mandantenfähigkeit) und zwölf statt acht
  Chips; die vier bestehenden auf den aktuellen Stand gebracht. „Demo öffnen"
  steht gleichberechtigt neben der Anmeldung — ohne diesen Weg bliebe die Seite
  eine Behauptung.

### Fixed
- ⚠️ **Der Wechsel in die Demo holte die Sitzung nicht neu.** Wer sie von der
  Landing Page aus öffnete, hatte `/auth/me` längst gegen den echten Server
  laufen lassen („nicht angemeldet") — `/demo` zeigte deshalb wieder die
  Landing Page statt des Boards. Die Abfrage hängt jetzt an der Route.
- ⚠️ **Der Live-Sync legte die Demo lahm.** Die Schleife hält eine Anfrage
  offen, bis sich etwas ändert; der Server antwortet dafür bis zu 25 s nicht.
  Die Demo antwortete sofort „nichts geändert", woraufhin die Schleife
  ununterbrochen nachfragte und der Browser nicht mehr reagierte (live
  gesehen). In der Demo läuft sie gar nicht — es gibt kein zweites Gerät.
- ⚠️ **Ein Anlegen erzeugte zwei Karten.** Der Demo-Router gab sein internes
  Array zurück; die App aktualisiert optimistisch und schrieb damit in denselben
  Speicher, sodass der Prompt zweimal in der Liste stand (samt React-Warnung
  über doppelte Keys). Es werden jetzt ausschließlich Kopien herausgegeben.

### Internal
- `lib/demo.ts` (Daten + Router, rein und getestet) hängt an **einer** Naht in
  `lib/api.ts`. Darüber läuft die echte Oberfläche — die Demo zeigt damit
  immer, was die App heute tut, statt eines zweiten Nachbaus, der veraltet.
- **34 neue Tests** für den Demo-Router, acht Mutationsproben. ⚠️ Drei davon
  waren zunächst wirkungslos: „sagt ab" hielt auch ohne die Wache (die Pfade
  fielen in die Auffang-Absage), „landet oben" wurde von einem nicht gesetzten
  `sort_order` zufällig erfüllt, und „Prompts überleben das Projekt" galt auch,
  wenn man sie mitlöschte. Alle drei prüfen jetzt die unterscheidende Tatsache.

## [0.60.0] - 2026-09-01

### Added
- **„Über cue" als letzter Abschnitt der Einstellungen** — Version, Entwickler,
  Spenden-Knopf, „Auf Google Maps bewerten" und ein aufklappbarer Changelog.
  cue hat keinen „System"-Bereich; die Einstellungen sind die Stelle, an der
  schon alles steht, was die App als Ganzes betrifft.
- **Version im Footer** (`© 2026 Martin Pfeffer | celox.io · v0.60.0`) —
  dezent in derselben Zeile, nicht als zweite.
- **Der Changelog in der App ist die Datei `CHANGELOG.md` selbst**, beim Bauen
  eingebettet und geparst; es gibt bewusst keine zweite, von Hand gepflegte
  Fassung. Gleiches Vorgehen wie im About-Bildschirm von BeatByte.
- `renderInlineMarkdown` im geprüften Markdown-Renderer: die Changelog-Punkte
  nutzen durchgehend `**fett**` und `` `code` `` — roh dargestellt stünden dort
  Sternchen, und der Block-Renderer machte aus einem Listenpunkt je nach
  Anfangszeichen eine Überschrift.

### Changed
- Die Versionsnummer hat weiterhin **eine** Quelle (`backend/app/main.py`); das
  Frontend bekommt sie beim Bauen über `__APP_VERSION__`
  (`frontend/app-version.mjs`), nicht über eine Kopie in einem Manifest.
  ⚠️ Die Ableitung liegt in einem eigenen Modul, weil `vite.config.ts` und
  `vitest.config.ts` getrennte Dateien sind und die zweite **nichts** von der
  ersten erbt — zwei Ableitungen wären zwei Stellen, die auseinanderlaufen.
- Der Dockerfile reicht `backend/app/main.py`, `CHANGELOG.md` und `scripts/` in
  die Frontend-Stage, aus demselben Grund wie `contracts/`: die Dateien
  gehören keiner Seite allein.

### Fixed
- ⚠️ **Der Image-Build benutzte seit dem 14. Juli eine veraltete
  Vite-Konfiguration.** Ein kompiliertes `vite.config.js` (Rest eines alten
  `tsc -b`, lokal längst behoben) lag noch auf dem Server — und weil der Deploy
  bewusst **ohne `rsync --delete`** läuft, damit die `.env` überlebt,
  verschwand es dort nie. Vite lädt `.js` **vor** `.ts`, also wurde jede
  Änderung an der echten Konfiguration im Docker-Build still ignoriert. Der
  Fehler fiel nur auf, weil die Version im ausgelieferten Bündel fehlte:
  gemessen stand dort noch der Platzhalter `__APP_VERSION__`. Inhaltlich waren
  die beiden Fassungen bis auf die heutigen Zusätze identisch, der Schaden also
  gering — die Falle nicht. Jetzt sperrt die `.dockerignore` solche Reste aus
  dem Build-Kontext aus, und `ops/deploy.sh` löscht sie vor dem Bauen.
- ⚠️ Aus demselben Anlass: **`globIgnores` schließt den Changelog-Chunk auf
  macOS aus und auf Linux nicht** — die Glob-Auflösung hängt an der
  Groß-/Kleinschreibung des Dateisystems, und es gibt zwei Chunks, die sich nur
  darin unterscheiden. Ersetzt durch eine `manifestTransforms`-Filterfunktion,
  die auf beiden Systemen dasselbe tut.

### Internal
- **Vier Tests erzwingen die Changelog-Regel**, alle mutationsgeprüft:
  Eintrag für die ausgelieferte Version vorhanden · Eintrag hat auch einen
  Inhalt, nicht nur eine Überschrift · Versionen eindeutig und neueste zuerst ·
  der Parser der App versteht die echte Datei
  (`changelog.contract.test.ts`). Dazu verbietet
  `test_the_frontend_does_not_hardcode_a_version` eine zweite Versionsangabe im
  Frontend. Die Regel steht in `CONTRIBUTING.md`.
- ⚠️ Der Changelog-Chunk ist vom PWA-Precache **ausgenommen**. Der dynamische
  Import allein genügte nicht: der Service Worker zog die 36 kB (gzip) trotzdem
  bei jedem Erstbesuch mit — gemessen 1131 → 1221 KiB, mit `globIgnores` wieder
  1136 KiB. Dieselbe Entscheidung wie bei den Landing-Screenshots.

## [0.59.1] - 2026-09-01

### Added
- **Wo die App live läuft, steht jetzt überall dort, wo jemand danach sucht:** in
  der GitHub-Beschreibung, im Homepage-Feld des Repos, als erster Link unter dem
  Titel des README und als eigener Abschnitt „Live" mit Anmeldeweg, Installation
  und Betriebsangaben.
- **Thumbnail** ganz oben im README (das Board), zentriert über Titel, Live-Link
  und den beiden Hero-Badges.
- **Spenden per PayPal** und **celox.io auf Google Maps bewerten** — als Knöpfe
  im Kopf und als eigener Abschnitt „Unterstützen" am Ende. Beides in derselben
  Form wie in Inspector Rust, zauberkoch und BeatByte, mit denselben Zielen
  (`martin.pfeffer@celox.io` bzw. `g.page/r/CXgdRV3QysvxEBM/review`) — nichts
  davon erfunden, alles aus den bestehenden Projekten übernommen.
- Repo-Themen gesetzt (claude-code, prompt-management, kanban, fastapi, react,
  typescript, pwa, self-hosted, sqlite, material-design-3).

### Fixed
- ⚠️ **`CLAUDE.md` behauptete, das Repository sei privat — es ist öffentlich**
  (mit `gh repo view` geprüft). Die Beschreibung auf GitHub nannte cue außerdem
  noch „single-user", was seit 0.16.0 falsch ist. Beides korrigiert; ein
  Musterscan über den getrackten Baum fand erwartungsgemäß keine Geheimnisse
  (die `sk-ant-*`-Treffer sind offensichtliche Test-Attrappen).

## [0.59.0] - 2026-09-01

### Added
- **Version und Codegröße stehen jetzt oben, groß, über allem anderen** (eigener
  `hero:dynamic`-Block, `for-the-badge`-Stil).
- **67 Badges statt 20** — Tests je Suite, Coverage, Testgewicht, Codegröße je
  Sprache, Quelldateien, reine Module, Komponenten, Hooks, Endpunkte, Router,
  Tabellen, Migrationen, Schemas, Einstellungen, Optimierer-Provider, Releases,
  Datum des letzten Release, Doku-Seiten, Lizenz.
- **Der Tech-Stack liest seine Versionen aus den Manifesten.** „React 18",
  „FastAPI 0.115", „pytest 9" und ein Dutzend weitere standen als getippte
  Literale im README und wären beim nächsten Upgrade still falsch geworden —
  niemand liest ein Badge nach, das er selbst geschrieben hat. Sie kommen jetzt
  aus `pyproject.toml` und `package.json`.
- Damit gibt es **keinen Wert mehr im Badge-Bereich, den jemand von Hand
  nachziehen müsste**; `npm test` schreibt alles neu.

### Fixed
- ⚠️ **Ein echter Fehler, gefunden beim Testschreiben:** wirft `execCommand` —
  was ein sandboxed iframe ohne `allow-clipboard-write` tut, statt `false` zu
  liefern —, entfernte `copyText` das Hilfs-Textfeld nicht mehr. **Jeder
  gescheiterte Kopierversuch ließ eines unsichtbar auf der Seite zurück.** Die
  Aufräumung steht jetzt in einem `finally`.
- ⚠️ `parseRequiresPython` scheiterte an einer gültigen Obergrenze
  (`">=3.11,<4.0"`) — das schließende Anführungszeichen war zu streng verlangt.
  Der eigene Test fand es.

### Internal
- **36 neue Skript-Tests** (26 → 62) für jeden neuen Parser, alle 14 neuen
  Zusicherungen einzeln mutationsgeprüft.
- ⚠️ Eine davon war **grün-blind**: „findet kein Paket, dessen Name nur gleich
  ANFÄNGT" deckt die Namensgrenze nicht ab — der unterscheidende Fall ist ein
  Name, der das **Ende** eines anderen ist (`dantic` in `pydantic>=2.9`).
- Neue Tests für Pfade, die noch nie gelaufen waren: der **Standard-Zeitgeber**
  des Long-Press (bis dahin spritzten alle Tests einen eigenen ein — die
  Produktionsvariante war unerprobt), die werfenden Zweige von `copyText` und
  `vibrate`, ein `navigator` ohne Plattformangabe, `BackStack.clear`, und
  Optimierungs-Historie aus der Zeit vor Titel/Tags.
- **Der Generator prüft seine eigenen Links, bevor er schreibt.** Ein Badge mit
  kaputtem relativem Link legte ihn lahm: er lässt die Backend-Suite laufen, um
  Coverage zu messen, und die prüft die README-Links — er konnte die Datei also
  nicht reparieren, deren Zustand ihn blockierte.
- `test_docs.py` streift jetzt **jeden** generierten Block statt eines
  namentlich genannten; eine von Hand zu pflegende Liste wäre genau die Sorte
  Drift, gegen die der Test existiert.
- ⚠️ **`npm test` prüft jetzt auch Typen.** vitest transpiliert nur — ein Test
  mit falscher Aufrufsignatur lief grün durch und fiel erst beim Build auf.
  Genau so passiert, beim Schreiben der Tests dieser Runde.

## [0.58.0] - 2026-09-01

### Added
- **Die KI schreibt jetzt auch Titel und Schlagworte um.** Ein umgeschriebener
  Prompt, dessen Titel noch die alte Formulierung beschreibt, ist nur halb
  umgeschrieben. Beides reist als eigener Vorschlag mit, wird **vor** der
  Entscheidung als „alt → neu" angezeigt und erst mit „Übernehmen" geschrieben.
- **Die Schlagworte des Kontos gehen als Vokabular mit in die Anfrage.** Das ist
  der Unterschied zwischen „Schlagworte vorschlagen" und „das vorhandene Schema
  weiterführen": ohne die Liste erfindet ein Modell `bug-fixing` neben dem
  `bugfix`, das seit Monaten in Gebrauch ist.
- Bookmarks lösen auch ihren **Titel** vom Projekt — er benennt die Aufgabe,
  nicht das Repository.

### Changed
- Meta-Prompt auf **Version 4** (strukturierte Antwort mit `--- TITEL ---`,
  `--- TAGS ---`, `--- PROMPT ---`). Jede Historienzeile hält fest, mit welcher
  Fassung sie entstanden ist — alte Einträge ändern ihre Bedeutung nicht.
- `prompt_optimization` bekommt vier additive Spalten: die Momentaufnahmen
  `original_title`/`original_tags` und die Vorschläge
  `optimized_title`/`optimized_tags`. Bestandszeilen bleiben leer, was genau
  „dieser Versuch hat dafür nichts vorgeschlagen" heißt.

### Internal
- ⚠️ **Der Körper muss jede Antwortform überleben.** Ein Modell, das das Format
  ignoriert und einfach den umgeschriebenen Prompt liefert — so sah **jede**
  Antwort vor v4 aus —, hat eine gute Optimierung produziert; sie wegen
  fehlender Verpackung zu verwerfen hieße, einen bezahlten Aufruf wegzuwerfen.
  Ohne `--- PROMPT ---` ist der ganze Text der Körper, und es wird nichts
  vorgeschlagen.
- ⚠️ Ein **leerer** Vorschlag löscht nichts: „das Modell hat nichts
  vorgeschlagen" und „alle Schlagworte sollen weg" sehen im Ergebnis gleich
  aus, und nur eine der beiden Lesarten ist verlustfrei. Server und Anzeige
  folgen derselben Regel.
- Schlagworte werden über den **`TagService`** geschrieben, nicht in den
  Komma-Cache — sonst kennt die Tags-Verwaltung die neuen Einträge nicht.
- Titel und Tag-Zahl werden **geklemmt**, nicht geglaubt: um höchstens vier
  Schlagworte zu bitten ist nicht dasselbe, wie sie zu erzwingen.

### Fixed
- ⚠️ **Eine Mutationsprobe fand eine echte Lücke:** das Vokabular aus dem
  Service zu entfernen ließ alle Tests grün, weil der einzige Vokabular-Test
  `build_meta_prompt` direkt aufrief. Der unterscheidende Fall ist ein
  Schlagwort, das an einem **anderen** Prompt hängt — es kann nur auftauchen,
  wenn der Service die Schlagworte des Kontos wirklich liest.

## [0.57.0] - 2026-09-01

### Added
- **Langer Druck auf den Prioritäts-Knopf setzt zurück auf „mittel".** Der
  Zyklus ist bequem, taugt aber schlecht zum Zurücknehmen: von „hoch" auf den
  Standard führt er durch „gering" hindurch, also über einen Zustand, den
  niemand meint. Halten ist deshalb kein vierter Zustand, sondern der kurze Weg
  zurück — 500 ms, der Plattformwert, den die Finger schon gelernt haben.
- Der Knopf **sagt es selbst**: „Priorität: Hoch — klicken für Gering · lange
  drücken für Mittel". ⚠️ Nur dort, wo das Halten etwas **anderes** tut als der
  Klick — auf „gering" führen beide nach „mittel", und der Hinweis hätte
  dasselbe zweimal gesagt (im Browser gesehen, nicht gemutmaßt).
- Auf einem Prompt, der schon „mittel" ist, wird **nichts geschrieben** — der
  Klick danach aber trotzdem geschluckt. Ohne das hätte ausgerechnet die Geste
  „zurück auf Standard" den Prompt auf „hoch" gesetzt.

### Internal
- Neues reines Modul `frontend/src/lib/long-press.ts` (Auslöse-Regeln,
  Slop-Toleranz, Buchführung) plus `state/long-press.ts` als React-Verdrahtung —
  derselbe Schnitt wie `live-sync` und `route`. **12 neue Tests**, alle sechs
  neuen Zusicherungen einzeln mutationsgeprüft.
- `priorityAfterPress(current, kind)` in `lib/order.ts` ist die eine Quelle für
  Aktion **und** Beschriftung; ein Halten kann damit nicht versehentlich wieder
  im Zyklus landen.
- ⚠️ `.prio-btn` unterbindet Textauswahl und iOS-Callout: die Glyphe **ist**
  Text (Material-Symbols-Ligatur), ein langer Druck hätte sie markiert.

### Fixed
- ⚠️ Ein eigener Test war eine **falsche Behauptung**, nicht ein Fehler im Code:
  „ein Halten liefert nie das Zyklus-Ergebnis" stimmt nur von „hoch" aus — von
  „gering" führen beide Gesten legitim nach „mittel". Der Test prüft jetzt den
  einen Fall, in dem sie sich unterscheiden.

## [0.56.1] - 2026-08-30

### Documentation
- **Ausführlicher Doku-Durchgang** nach neun Feature-Versionen — die `docs/`
  waren auf dem Stand von 0.47.0 und behaupteten teils das Gegenteil des Codes.
- `ARCHITECTURE.md`: die Aussage „Optimierung ist owner-only" ist seit 0.54.0
  **falsch** und korrigiert; neu die Sektionen **„Eine Regel, drei Spiegel"**
  (die Spaltenordnung samt der zwei Bedingungen, die jede neue Sortierregel
  erfüllen muss) und **„Zwei Wege für die Optimierung — und wer sie bezahlt"**;
  dazu Routing/Landing-Page, das erweiterte Datenmodell und die neuen Module.
- `SECURITY.md`: neuer Abschnitt **„Fremde API-Schlüssel"** (Verschlüsselung im
  Ruhezustand, keine Rückgabe, Prüfung vor dem Speichern, getrennte Rechte für
  Ausgeben und Lesen) sowie zwei ehrliche Grenzen: **kein Ausgabenlimit** und
  Kostenzahlen, die auf dem API-Weg **Schätzung** sind.
- `CONFIGURATION.md`: `OWNER_EMAIL` beschrieb sich als alleiniger Auslöser der
  Optimierung; korrigiert und erklärt, warum der Schlüssel je Nutzer bewusst in
  der Datenbank statt in der Umgebung liegt.
- `API.md`: fünf statt vier Zugangsarten (`require_optimizer`), plus die vier
  Felder, die die Spaltenordnung mitbestimmen.
- `TESTING.md`: `test_deps_contract.py` als sechste Eigenschafts-Suite und die
  zwei grün-blinden Tests dieser Runde (Rundung je Zeit-Eimer, Runner-Claim).
- `CONTRIBUTING.md`: **eine Abhängigkeit gehört in zwei Dateien** und die
  Bedingungen für neue Sortierregeln; `cue-runner/README.md`: der
  Optimierungs-Loop und die bislang undokumentierten Umgebungsvariablen.

### Fixed
- ⚠️ **Ein sporadisch roter Test hatte eine echte Ursache**, keine Zufallslaune:
  `tests/test_housekeeping.py` ersetzt `asyncio.sleep` auf dem **geteilten**
  Modul, also sahen es alle Event-Loops im Prozess — auch die echten
  Hintergrund-Tasks im Portal-Thread des TestClients. Deren 60-s-Weckrufe
  wurden als eigene gezählt und konnten den `CancelledError` abfangen. Gegen
  einen konkurrierenden Loop gemessen: **187.301 gestohlene Aufrufe statt 1**.
  Es zählen jetzt nur noch Aufrufe aus der eigenen Task.
- ⚠️ Der zugehörige Regressionstest war in **zwei** Fassungen wirkungslos
  (einmal immer grün, einmal zwei von drei Läufen), weil er auf ein
  Mikrosekunden-Fenster hoffte. Jetzt wird die Überlappung **erzwungen**: der
  getriebene Schleifenkörper wartet, bis der konkurrierende Loop wirklich
  Aufrufe im Patch-Fenster gemacht hat — Mutationsprobe 5× rot, 5× grün.

## [0.56.0] - 2026-08-30

### Changed
- **„Genau testen" führt jetzt die Done-Spalte an.** Markierte Prompts stehen
  ganz oben — das kehrt die Entscheidung aus 0.53.0 („reiner Marker, keine
  Sortierung") auf Wunsch um.
- ⚠️ **Unterhalb des Getestet-Schnitts**, nicht darüber: ein markierter Prompt,
  der bereits getestet ist, würde sonst über die ungeprüften klettern — aus dem
  zugeklappten Block heraus zurück in den Teil, der „noch zu tun" bedeutet,
  nachdem der genaue Blick stattgefunden hat. Außerhalb von Done bewegt das
  Flag weiterhin nichts.
- Wie bei der Priorität gilt: ein Zug über die Bandgrenze prallt zurück, aber
  das Flag umzuschalten bringt die Karte immer dorthin.

### Added
- **Echter Screenshot der Optimierungs-Ansicht** auf der Landing Page
  (`/landing/optimize-demo.png`, 2560×1640 wie die übrigen): Diff mit
  +18/−1, Versionsschalter und die Entscheidungsleiste „Übernehmen /
  Verwerfen". Die Karte lief bis hierhin ohne Bild, weil das einzige
  vorhandene die Snippet-Bibliothek zeigte.

### Internal
- Dritter Rundgang durch **alle drei Spiegel** der Spaltenordnung
  (`display_key`, `columnComparator`, `BOARD_ORDER_SQL`) plus 3 neue Fälle im
  geteilten Vertrag; jeder Spiegel einzeln mutationsgeprüft (3 / 1 / 2 rote
  Tests).

## [0.55.0] - 2026-08-30

### Added
- **Landing Page unter `/willkommen`.** Eingeloggte Nutzer landen auf `/`
  weiterhin **direkt** in der App; Besucher sehen die Landing Page — Hero mit
  Nutzenversprechen, vier Funktionen, Chips für den Rest, Google-Login als CTA
  oben und unten. Wer eingeloggt zurückkommt, sieht dieselbe Seite mit
  „Zur App" statt Anmelden.
- **Rückweg aus dem Header:** ein „Startseite"-Knopf rechts in der Kopfleiste
  (44 px, auch auf dem Handy erreichbar) und zusätzlich der Klick auf den
  Schriftzug — die Konvention des Webs, und sie kostet in einer bei 390 px
  ohnehin engen Leiste keinen Platz.
- **Eigene Adresse statt bloßem Zustand** (`lib/route.ts` + `state/route.ts`):
  teilbarer Link, Browser-Zurück, und ein Reload bleibt auf der Seite. Kein
  Router-Paket — 50 Zeilen History-API, Regeln framework-frei und mit 6 Tests.

### Changed
- `components/Login.tsx` ist **entfallen**; die Landing Page trägt jetzt den
  Anmelde-CTA und die OAuth-Fehlermeldungen (Google leitet Fehler nach `/` mit
  `?auth_error=` zurück). Die Reihenfolge dreht sich damit bewusst um: bisher
  stand die Login-Karte oben und die Tour darunter.
- Die Funktionsliste war veraltet — Priorität, „Getestet", der Statistik-Ausbau
  und der eigene API-Key fehlten.

### Internal
- ⚠️ Die Route hängt an `popstate` **neben** dem Overlay-Stack, ohne ihn zu
  stören: dessen Einträge werden als `pushState(state, '')` **ohne
  URL-Argument** gepusht und bewegen den Pfad daher nie. Live geprüft: Dialog
  offen → Zurück schließt den Dialog, Route unverändert.
- ⚠️ `.google-btn` trägt `width: 100%` aus der alten Login-Karte — im Kopf zog
  sich der Knopf über 1045 px. Auf die Landing-Kopfleiste begrenzt.
- ⚠️ Ein `overflow-y: auto` auf `.landing-main` war **wirkungslos**: `body` ist
  der Scroller dieser App. Entfernt, statt einen inneren Scroller
  vorzutäuschen.

## [0.54.1] - 2026-08-30

### Fixed
- ⚠️ **Zwei Abhängigkeitslisten, eine gepflegt — Produktion stand kurz auf 502.**
  `cryptography` und `anthropic` landeten nur in `pyproject.toml`; das
  Docker-Image installiert `backend/requirements.txt`. Der Build lief sauber
  durch, der Container tauschte, und erst der Import scheiterte
  (`ModuleNotFoundError`). Beide Pakete sind jetzt in beiden Listen.
- **`tests/test_deps_contract.py`** hält die zwei Listen aneinander — gleiche
  Pakete, gleiche Versionsgrenzen (mutationsgeprüft mit genau dem Ausfall, der
  passiert ist).
- **`ops/deploy.sh` testet das gebaute Image, bevor es umschaltet:** ein
  Wegwerf-Container importiert `app.main`. Ein erfolgreicher Build sagt, dass
  die Layer zusammengesetzt wurden — nicht, dass die App startet; der
  Health-Check merkt es erst, wenn der alte Container schon weg ist.

## [0.54.0] - 2026-08-30

### Added
- **Eigener Anthropic-API-Key je Nutzer.** Wer einen hinterlegt, kann Prompts
  optimieren — abgerechnet auf sein eigenes Konto. Der Key wird vor dem
  Speichern gegen die API geprüft, **verschlüsselt** abgelegt
  (`app/secrets_store.py`, Fernet mit einem aus `SECRET_KEY` abgeleiteten
  Schlüssel) und **nie wieder ausgegeben** — die Oberfläche sieht nur die
  letzten vier Zeichen. Einstellungen → „KI-Optimierung — eigener API-Key",
  inklusive Modellwahl mit Listenpreisen.
- **Zwei Ausführungswege, zwei Zahler.** Der Betreiber bleibt unverändert auf
  der Claude-Code-CLI seines Runner-Macs; wer einen eigenen Key hat, dessen
  Optimierungen laufen **serverseitig** gegen die Messages API
  (`optimization/server_executor.py`, ein Job zur Zeit, Worker in der
  Lifespan). Der Provider wird beim Einreihen aus dem Nutzer abgeleitet, nicht
  aus einer globalen Einstellung.
- **Kosten aus der Nutzung berechnet** (`optimization/pricing.py`): die
  Messages API meldet vollständige Token-Zahlen, aber keinen Preis. Preistabelle
  zentral, mit Stand-Datum, Cache-Faktoren (Schreiben 1,25×, Lesen 0,1×) und
  sechs Nachkommastellen — eine Haiku-Optimierung landet bei $0,0008.

### Changed
- Die Optimierungs-Routen sind nicht mehr pauschal owner-only. **Geld ausgeben**
  (einreihen, Batch, Config) verlangt Besitzer **oder** eigenen Key; **lesen und
  entscheiden** ist nur noch mandantengebunden. Wer seinen Key entfernt,
  verliert damit nicht den Zugriff auf Vorschläge, die er schon bezahlt hat.
- ⚠️ Der Claim des Mac-Runners ist auf **runner-ausgeführte** Provider
  eingeschränkt. Ohne das hätte er einen Job, der gegen einen fremden Key
  laufen soll, mit der CLI ausgeführt — die Arbeit wäre passiert, auf dem
  falschen Konto.

### Internal
- Neue Abhängigkeiten `anthropic` (offizielles SDK) und `cryptography`
  (Verschlüsselung der Keys — die nächtliche Sicherung trägt diese Tabelle
  sonst im Klartext vom Server).
- ⚠️ Die beiden Wege teilen **keinen** Modellnamen: `OPTIMIZE_MODEL` ist ein
  CLI-Alias („opus"), den die Messages API ablehnt. Server-Jobs nehmen das
  Modell des Nutzers oder den bepreisten Standard.

## [0.53.0] - 2026-08-30

### Added
- **„Genau testen"** — ein rotes `!` an fertigen Prompts, gesetzt oder nicht.
  Es sitzt an derselben Stelle wie der Prioritäts-Umschalter, der nur in der
  Queue erscheint: dort lautet die Frage „wie dringend", in Done „wie genau
  muss das geprüft werden". Die beiden treffen sich nie auf einer Karte.
  Zusätzlich als Umschalter im Detail-Dialog.
- **Reiner Marker, keine Sortierung** (Nutzer-Entscheid): die Reihenfolge in
  Done bleibt wie sie ist.
- Das Flag **überlebt einen Statuswechsel** — anders als `tested`, das ein
  Ergebnis ist und von einer Überarbeitung entwertet wird. „Muss genau getestet
  werden" ist eine Absicht über die Arbeit und gilt weiter, wenn der Prompt
  zurück in die Queue geht. Ein Duplikat erbt es; beim Zusammenführen genügt
  **eine** markierte Quelle, damit das Ergebnis markiert ist.

### Fixed
- **`--md-error` ist in diesem Theme gar nicht rot.** Die Fehlerfarbe wird aus
  dem Seed erzeugt und landet, wo die Tonpalette sie hinsetzt: gemessen
  `#f2c6a6` (Pfirsich) im dunklen und `#b35919` (Braun) im hellen Theme — der
  helle Ton misst auf der hellen Karte **1,36:1**, also praktisch nichts. Neues
  Token **`--danger`** nach derselben Methode wie `--ok`/`--warn`, gemessen auf
  der echten Karte: **6,05:1 dunkel · 5,69:1 hell**.

## [0.52.1] - 2026-08-30

### Fixed
- **Einzelwerte je Prompt waren nicht eindeutig zuzuordnen.** „Teuerste
  Prompts" und „Kosten je Modell" liefen als Inline-Liste (`legend-list`,
  gedacht für kurze Statuswörter): ein Prompttitel und sein Betrag standen
  neben dem NÄCHSTEN Paar. Beide nutzen jetzt `recent-list` — eine Zeile je
  Eintrag, Titel links, Anzahl und Betrag rechtsbündig. Auf 390 px bleibt der
  Betrag im Kartenrahmen, der Titel kürzt mit Auslassungspunkten.
- „Ø Dauer" stand als sechste Kachel allein in einer zweiten Zeile; sie gehört
  ohnehin zu den Qualitätswerten und steht jetzt neben Erfolgs- und
  Übernahmequote. Die Kachelzeile ist damit auf dem Desktop wieder eine.

## [0.52.0] - 2026-08-30

### Added
- **Statistik-Abschnitt „Prompt-Optimierung".** Wie viele Prompts die KI
  umgeschrieben hat und was das gekostet hat — **gesamt**, **je Prompt**, **je
  Versuch** und als **Einzelwerte** (die teuersten Prompts mit Anzahl der
  Versuche). Dazu Erfolgs- und Übernahmequote, Kosten je Modell (Gesamt und
  Durchschnitt), Ø Dauer, Output-Tokens, der Median-Längenfaktor
  Original → übernommene Fassung und eine Kostenkurve je Intervall.
- ⚠️ **Die Kosten sind gemeldet, nicht geschätzt.** Es ist die Zahl, die die
  Claude-CLI selbst im `--output-format json`-Umschlag ausgibt
  (`total_cost_usd`), gespeichert in `PromptOptimization.cost_usd`. Der
  Abschnittskopf sagt das ausdrücklich. Bewusst gibt es **keine** Hochrechnung
  aus Tokenpreisen: die gespeicherten `input_tokens` enthalten keine
  Cache-/System-Eingaben — auf den Livedaten stehen **68 Input-Tokens für
  14 125 Zeichen Quelltext** (≈3 500 Tokens). Preis × Tokens aus diesen Spalten
  wäre keine Schätzung, sondern eine falsche Zahl im Gewand einer.
- Versuche ohne Kostenmeldung werden **gezählt und ausgewiesen** („nicht
  erfasst"), nie als 0 mitgemittelt.

### Fixed
- **Der Runner verwarf die Abrechnung fehlgeschlagener Optimierungen.** Der
  CLI-Umschlag trägt `total_cost_usd` auch neben `is_error`; damit sah jeder
  Fehlversuch in der Kostenstatistik kostenlos aus. Wird jetzt übernommen —
  wirkt nur auf künftige Versuche, die 14 bestehenden bleiben ohne Meldung.
- **Kostenbalken rundeten nach jeder Addition** und summierten sich dadurch
  nicht mehr auf ihren eigenen Gesamtwert (live gemessen: 45,5299 statt
  45,5297 über 66 Tagesbalken). Betraf beide Kostencharts, also auch die
  bestehende Run-Auswertung.

### Internal
- `stats.build` schlüsselt seinen Cache zusätzlich auf eine
  Optimierungs-Signatur: ein **fehlgeschlagener** Versuch fasst keine
  Prompt-Zeile an, der geteilte Änderungs-Fingerabdruck bewegt sich also
  nicht — ohne das säße die Fehlerzahl 120 s hinter der TTL fest.
- Kostenmodell und Einheit stehen als Block mit `COST_CURRENCY`/`COST_DECIMALS`
  am Kopf von `app/stats.py`, nicht verstreut.

## [0.51.0] - 2026-08-30

### Added
- **Priorität: gering · mittel · hoch.** Auf dem Board und in der Liste als
  **Umschalter** an der Karte (ein Klick von „mittel" macht dringend, der
  nächste macht gering, der dritte ist wieder mittel — drei Klicks sind von
  überall ein voller Kreis), im Detail-Dialog als **Dropdown** — in der
  Ansicht **und** im Bearbeiten-Modus.
- **Hoch zuerst in der Queue.** Priorität bündelt die Warteschlange in drei
  Bänder; innerhalb eines Bandes gilt weiter die selbst gezogene Reihenfolge.
- **Beim Zusammenführen gewinnt immer die höchste** Priorität der Quellen. Das
  ist keine Wahl im Dialog, sondern eine Regel: dringende Arbeit in einen
  ruhigen Prompt zu falten darf sie nicht stillschweigend herabstufen. Der
  Server leitet sie ab, das Formular schickt gar keine.
- Ein Duplikat übernimmt die Priorität — eine Kopie von etwas Dringendem ist
  ebenfalls dringend.

### Changed
- Der kompakte Umschalter erscheint **nur an Prompts in der Queue** — dieselbe
  Regel wie beim Blockiert-Schalter, denn nur dort wirkt er. Der Dropdown im
  Detail-Dialog ist überall verfügbar und sagt bei anderen Status dazu
  „wirkt in der Queue".

### Internal
- Die Sortierregel steht jetzt an **drei** Stellen synchron: `display_key`,
  `columnComparator` und — neu ausgewiesen — `BOARD_ORDER_SQL`, das die
  Neunummerierung beim Start benutzt. Der geteilte Vertrag
  (`contracts/column-order.json`) hat 5 neue Fälle, und ein neuer Test fährt
  jeden davon zusätzlich durch **SQLite**: der dritte Spiegel war bis hierhin
  ungetestet, und eine Abweichung dort schreibt still eine Reihenfolge fest,
  die niemand sieht.
- ⚠️ `priority_rank` vergleicht mit `==` statt über ein dict: `PromptPriority`
  ist ein str-Enum, dessen Mitglieder zwar gleich ihrem Wert sind, aber **nicht
  gleich hashen** — ein Dictionary-Zugriff ginge daneben.
- Migration setzt jede bestehende Zeile auf `normal`; die Board-Position bleibt
  damit exakt wie vorher (live an 21 Prompts geprüft).

## [0.50.0] - 2026-08-30

### Added
- **Getestete Prompts liegen in Done unter einem Deckel.** Was fertig UND
  geprüft ist, steht jetzt in einer zuklappbaren Sektion „✓ Getestet (n)"
  unter den ungeprüften — auf dem Board, in der Listenansicht und auf dem
  Handy. Der Kopf zeigt die Anzahl auch im zugeklappten Zustand: gefaltet wird
  die Kartenmenge, nicht die Information, dass es sie gibt.
- Der Zustand überlebt den Reload (`localStorage`, Schlüssel
  `cue-done-tested-open`) und gilt **board-weit, nicht pro Projekt** —
  Begründung siehe unten. Standard: zugeklappt, denn genau das ist der Zweck.
- Der gefaltete Block hat einen **eigenen „N weitere anzeigen"-Zähler**, klappt
  also unabhängig vom Teil darüber auf.

### Changed
- Auf dem Handy richtet sich die Voreinstellung der Projektgruppen jetzt nach
  dem **Teil** statt nach der ganzen Spalte: drei ungeprüfte Prompts bleiben
  offen, auch wenn darunter 100 getestete gefaltet liegen.

### Internal
- `lib/board-groups.ts:splitTested` (generisch über Prompts, 4 Tests,
  mutationsgeprüft — es partitioniert, statt am ersten getesteten Eintrag zu
  schneiden) und `state/tested-fold.ts:useTestedFold` als die eine Definition
  für beide Ansichten.
- ⚠️ Der gefaltete Block liefert **keine Sortier-Ids**, solange er zu ist —
  gemessen: gerenderte Karten und dnd-kit-Sortables stimmen in beiden
  Zuständen exakt überein (3/3 zu, 13/13 offen).

## [0.49.0] - 2026-08-30

### Changed
- **Ein geöffneter Prompt wird an Ort und Stelle bearbeitet.** Doppelklick (oder
  `e`, oder „Bearbeiten") tauscht im Detail-Dialog nur den INHALT gegen das
  Formular — vorher wurde der Dialog geschlossen und ein zweiter mit eigener
  Auftrittsanimation aufgebaut. Gemessen: das `.sheet`-Element ist danach
  **dasselbe DOM-Element**, es existiert nie ein zweiter Dialog, und Position
  und Größe bleiben unverändert (720×582 an derselben Stelle).
- **Der Moduswechsel ist animiert:** Kopf, Formular und Aktionszeile blenden um
  45 ms versetzt ein, das Formular steigt dabei von unten (y 12 → 0), die
  zurückkehrende Ansicht senkt sich von oben (y −12 → 0) — die beiden
  Richtungen lesen sich als Weggehen und Zurückkommen. `prefers-reduced-motion`
  überspringt das.
- **Speichern schließt den Dialog nicht mehr**, sondern zeigt das Ergebnis: man
  bleibt im geöffneten Prompt und sieht die neue Fassung.
- Escape/Zurück verlässt erst das Formular und schließt beim zweiten Druck den
  Dialog (`useBackDismiss`, dieselbe LIFO-Ordnung wie Lightbox und
  Projekt-Menü). Ein Klick daneben verwirft nichts mehr — dieselbe Regel, die
  der Composer beim Bearbeiten schon hatte.

### Added
- `lib/detail-keys.ts` — die Tastentabelle des Detail-Dialogs als reine
  Funktion, inklusive der Regel, dass im Bearbeitungsmodus **keine** Taste
  feuert (4 Tests, mutationsgeprüft).

### Fixed
- Cmd/Ctrl+A und Cmd/Ctrl+C des Detail-Dialogs standen im Formular nicht still.
  Eine Textarea-Auswahl gehört in Chrome **nicht** zu `window.getSelection()`,
  also hätte der Wächter sie nicht gesehen und Cmd+C hätte statt der Auswahl
  den ganzen Prompt kopiert.
- Cmd/Ctrl+Enter hätte im Formular gleichzeitig gespeichert **und** einen
  offenen Optimierungs-Vorschlag übernommen, den niemand angesehen hat.
- Bare `1`/`2`/`3` konnten den Prompt hinter dem Formular umstatusen, sobald
  der Fokus neben der Textarea lag (live nachgestellt und behoben).
- Screenshots per Einfügen kommen jetzt auch an, wenn der Fokus auf `<body>`
  liegt (nach einem Klick in die Vorschau) — der Listener hängt am Fenster
  statt am Dialogelement, das ein `<body>`-Paste nie erreicht.

### Internal
- Das Formular liegt in `components/PromptEditor.tsx` und hat damit **eine**
  Definition für beide Wirte (Composer und Detail-Dialog). Es rendert bewusst
  drei direkte Kinder ohne eigenen Container: die Layout-Regeln der Dialoge
  (`.sheet--x > *`) sprechen direkte Kinder an, ein Wrapper würde den
  Scrollbereich kollabieren lassen.

## [0.48.0] - 2026-08-30

### Changed
- **Ein zusammengeführter Prompt landet ganz oben in seiner Spalte**, nicht mehr
  hinten. Zusammenführen ist ein Akt der Kuration — man hat gerade entschieden,
  dass diese Prompts zusammengehören, und arbeitet als Nächstes am Ergebnis;
  angehängt verschwand es in einer Warteschlange mit Hunderten von Einträgen.
  Dieselbe Platzierungsregel wie bei einem `bug`-getaggten Anlegen oder einem
  frisch fertiggestellten Prompt (`_top_sort_order`). Die Regel folgt dem
  **gewählten Status**, ist also kein Sonderfall der Warteschlange: eine
  Zusammenführung nach „Done" steht dort ebenfalls oben. Zwei Tests pinnen
  beides, beide mutationsgeprüft (mit der alten Anhänge-Logik werden sie rot).

## [0.47.0] - 2026-08-28

### Added
- **Dokumentation, die nicht mehr rosten kann.** `backend/tests/test_docs.py`
  hält sie an den Code: jede Einstellung aus `config.py` muss in `.env.example`
  **und** in `docs/CONFIGURATION.md` stehen (und keines von beiden darf eine
  erfinden), jeder Route-Dekorator in `docs/API.md` (und umgekehrt), die
  ausgelieferte Version braucht einen CHANGELOG-Eintrag, der CHANGELOG muss
  eindeutig und neueste-zuerst sein, die generierten README-Marker müssen als
  eigene Zeile existieren, und **jeder relative Link in jedem Dokument muss
  auflösen**.
- **Vier neue Dokumente**: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (wie
  die Teile zusammenhängen), [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md)
  (jede Umgebungsvariable mit Standard und Wirkung),
  [`docs/API.md`](docs/API.md) (alle 90 Endpunkte, Berechtigungen, Statuscodes,
  Long-Poll) und [`docs/TESTING.md`](docs/TESTING.md) (die Methode inklusive der
  Mutationsprobe). Dazu [`SECURITY.md`](SECURITY.md) und
  [`CONTRIBUTING.md`](CONTRIBUTING.md).
- **Vierte Testsuite**: `scripts/tests/` (26 Tests, `node --test`, ohne
  Abhängigkeiten) prüft die Parser des Badge-Generators. Die riskante Stelle
  war nie das Einsammeln, sondern die Regex über die Ausgabe eines Werkzeugs —
  eine, die still danebenparst, macht aus jedem Badge eine selbstbewusste Lüge.
- **20 generierte Badges statt 12**: dazugekommen sind Skript-Tests, Test-Dateien,
  Test-LOC, Test:Code-Verhältnis, CSS-LOC, DB-Tabellen, React-Komponenten und
  Doku-Seiten. Alle aus echten Quellen, keiner getippt.

### Fixed
- ⚠️ **Die README-Anleitung zum Backup sagte `cp`** — genau das, was das
  Sicherungsskript bewusst vermeidet. Ein `cp` ist nicht atomar, und das WAL
  hält bestätigte Transaktionen, die noch nicht in der Hauptdatei stehen
  (gemessen: 4,4 MB WAL neben 4,2 MB Datenbank). Jetzt dokumentiert:
  `.backup` über Python, plus der Hinweis, beim Zurückspielen die `-wal`/`-shm`
  der **ersetzten** Datei zu löschen.
- ⚠️ **Drei Einstellungen waren nirgends dokumentiert** — `CUE_DEV`,
  `OPTIMIZE_MAX_RETRIES`, `OPTIMIZE_STALE_GRACE`. Ausgerechnet die erste
  schaltet vier Produktionsschutzmaßnahmen ab.
- ⚠️ **Der Kommentar an `CUE_DEV` im Code war schlicht falsch**: er beschrieb
  eine harmlose Client-Voreinstellung. Tatsächlich hebelt der Schalter die
  Start-Prüfung, die geschlossene Allowlist, die Origin-Prüfung und die
  Owner-Sperre aus.
- **Die README-Prosa behauptete 290 Tests**, während die Badges 1038 zeigten,
  und nannte Coverage-Zahlen von vorgestern. Die Testtabelle wird jetzt
  **generiert** (`<!-- tests:dynamic -->`) — Zahlen, die jemand abtippen muss,
  sind Zahlen, die rosten.

### Note
- ⚠️ **Zwei der neuen Tests waren zunächst grün-blind**, gefunden nur durch die
  Mutationsprobe: (1) die Marker-Prüfung suchte den Marker als **Teilstring** —
  und die README erklärt ihre eigenen Marker in Backticks, was die Prüfung auch
  bei umbenanntem echtem Block erfüllte; jetzt wird eine **eigene Zeile**
  verlangt. (2) Der TOTAL-Zeilen-Test benutzte eine Eingabe, die auch eine
  schlampige Regex ablehnt — die unterscheidende Eingabe ist eine, in der das
  Wort TOTAL vorher in Prosa mit einer anderen Prozentzahl vorkommt.
- ⚠️ **Beim Ermitteln der Einstellungen muss der reguläre Ausdruck einen
  Zeilenumbruch zwischen `get(` und dem Namen zulassen** — black umbricht lange
  Aufrufe, `ATTACHMENTS_DIR` steht auf einer eigenen Zeile. Meine erste,
  einzeilige Fassung meldete das Gegenteil: eine dokumentierte Einstellung, die
  es im Code angeblich nicht gibt.

## [0.46.0] - 2026-08-27

### Changed
- **Das Tag-Feld trennt jetzt „nimm den Vorschlag" von „nimm mein Wort".**
  `→` und `Tab` übernehmen den **Vorschlag** (die graue Ergänzung bzw. die
  markierte Zeile); **Enter, Leertaste und Komma** speichern **das Getippte
  wörtlich** als eigenes Tag. Danach ist das Feld sofort für das nächste Tag
  bereit und die Liste öffnet wieder — neu sortiert nach dem, was mit dem
  gerade gesetzten Tag zusammen auftritt.
  Vorher nahm Enter den Vorschlag: wer ein eigenes Wort schreiben wollte, das
  der Katalog halb erriet, musste hinterher wegräumen, was das Feld gerade für
  ihn getan hatte.
- **Das Tag-Feld zeigt den Vorschlag jetzt inline** als graue Ergänzung hinter
  dem Cursor — dieselbe Darstellung wie im Titelfeld, mit `→` statt `↵` auf dem
  Tastenhinweis. Erst dadurch bekommt `→` überhaupt eine Bedeutung: es gibt
  sichtbaren Text, in den man hineinfährt. Die Liste bleibt für `↑/↓` und Klick.

### Fixed
- **Escape im Tag-Feld schloss den ganzen Dialog.** Jetzt schließt der erste
  Druck die Vorschlagsliste, der zweite den Dialog — wie im Titelfeld.

### Note
- ⚠️ **Die Vorschlagstasten greifen nur, solange wirklich getippt wird.** Bei
  leerem Token listet das Menü weiterhin Tags, und `Tab` dort auf „übernehmen"
  zu legen würde die Tastatur im Feld **einsperren**: jede Übernahme öffnet das
  Menü erneut, es gäbe also keinen Druck mehr, der den Fokus weiterträgt. Mit
  leerem Token trägt `Tab` den Fokus weiter und `→` bewegt den Cursor.
- ⚠️ **Die Leertaste ist hier ein Trennzeichen, nie ein Zeichen.** Geprüft, statt
  angenommen: über 291 Prompts und 20 Tags enthält **kein einziges** Tag-Token
  ein Leerzeichen (sie sind einwortig, mit Bindestrich).
- ⚠️ **Der Ghost-Text prüft den Präfix groß-/kleinschreibungsgenau.** „Sec" +
  „urity" würde „Security" anzeigen, während `→` das katalogisierte „security"
  einträgt — eine kleine Lüge, und lügender Ghost-Text ist schlimmer als keiner.
  Bei abweichender Schreibung bleibt das Feld grau-frei; der Vorschlag steht
  weiter in der Liste und `→`/`Tab` nehmen ihn (in kanonischer Schreibweise).
- Die Tastenlogik liegt als reine Tabelle in `lib/tag-keys.ts` und ist einzeln
  getestet: die Einsperr-Gefahr, der Cmd+Enter-Durchlass (das Speichern-Kürzel)
  und die Escape-Abgrenzung sind aus einer gerenderten Komponente heraus sonst
  nicht prüfbar.

## [0.45.0] - 2026-08-26

### Added
- **Der Titel vervollständigt sich Wort für Wort.** Das Feld zeigt den nächsten
  Wortvorschlag als graue Fortsetzung hinter dem Cursor; **Enter** übernimmt
  **genau ein Wort**, danach steht sofort der nächste Vorschlag da — so lässt
  sich ein Titel Wort für Wort zusammensetzen, ohne die Kontrolle über den Satz
  abzugeben. `→` am Feldende tut dasselbe (fish/zsh-Gewohnheit), Escape blendet
  den Vorschlag aus, **ohne den Dialog zu schließen**. Tab bleibt bewusst
  Fokuswechsel: das hier ist ein Formularfeld, kein Editor.
- **Die Vorschläge stammen aus den eigenen bisherigen Titeln** (`lib/title-complete.ts`),
  nicht aus einer Wortliste. Gemessen am Live-Bestand (291 Titel): 94 davon sind
  genau zwei Wörter lang, „optimieren" kommt 20×, „animation" 11×, „fixen" 8× vor
  — genau diese Wiederholung macht ein n-Gramm-Modell über den eigenen Bestand
  brauchbar und eine generische Liste nutzlos.
- **Tags entstehen aus dem Titel** (`lib/tag-rules.ts`). „doku updaten" trägt
  `documentation` ein, „theme wechsel fixen" trägt `bugfix` ein — das Feld füllt
  sich, solange man es nicht selbst anfasst, und eine Zeile darunter sagt, woher
  die Tags kommen, mit „Entfernen" daneben. Beim **Bearbeiten** eines
  bestehenden Prompts passiert das nie: dessen Tags sind eine getroffene
  Entscheidung.
- **Die Tag-Auswahl ordnet nach dem, was der Prompt nahelegt**: Tags aus dem
  Titel zuerst (✨ „Passt zum Titel"), dann Tags, die mit den bereits gewählten
  zusammen auftreten (🔗 „Wird oft zusammen verwendet"), erst danach die reine
  Häufigkeit. Beides bricht nur **Gleichstände** — wer „sec" tippt, bekommt
  weiterhin `security`, egal was der Titel sagt.

### Note
- ⚠️ **Die Schwellen sind gemessen, nicht geschätzt** (Leave-one-out über
  denselben Bestand): ein Wort aus dem Kontext zu raten trifft zu 20 %, auf
  einem **leeren Feld nur zu 2 %** — deshalb kommt ohne Eingabe nie ein
  Vorschlag. Beim Vervollständigen des getippten Wortes sind es 25 % (1 Zeichen),
  36 % (2), **51 % (3)** — deshalb beginnt der Vorschlag ab dem zweiten Zeichen.
  Ein falscher Vorschlag kostet nichts: er ist träger grauer Text, der beim
  nächsten Tastendruck verschwindet. Genau diese Asymmetrie rechtfertigt 36 %.
- ⚠️ **Automatisch geschrieben wird nur, was messbar trägt.** Für jedes
  Stichwort wurde der Hebel gegen die Grundrate bestimmt: `doku`→documentation
  86 % (×28,3), `animier`→animation 82 % (×8,2), `fix|fehler`→bugfix 75 % (×4,8),
  `mobil|s24`→mobile ×38,5. Dagegen `optimier`→optimization nur ×1,8 und
  `button|icon|menü`→gui **gar kein Hebel** — beide werden deshalb nur
  vorgeschlagen, nie eingetragen. Ein falsches Tag, das ungefragt geschrieben
  wird, ist schlimmer als gar keins.
- ⚠️ Höchstens **zwei** Tags werden automatisch gesetzt: von 231 getaggten
  Prompts tragen 208 genau ein oder zwei.
- Der Ghost-Text schweigt, sobald der Titel breiter ist als das Feld — dann
  scrollt das Eingabefeld und die Überlagerung läge nicht mehr deckungsgleich.
  Gemessener Kontrast des Vorschlags: **4,58:1 hell, 6,94:1 dunkel**.

## [0.44.0] - 2026-08-23

### Changed
- **Die stillen Projekte im Board lassen sich wieder von Hand sortieren.**
  Chips ohne offene Prompts sind ziehbar, Chips mit Zähler nicht: deren Platz
  bestimmt die Zahl, ein Ablegen dort würde beim nächsten Rendern rückgängig
  gemacht und der Chip sichtbar zurückspringen. Ohne Zähler gibt es nichts, was
  die eigene Reihenfolge überstimmt — dort ist die Geste ehrlich.
  (0.42.0 hatte das Ziehen ganz entfernt; das war zu grob.)
- Die neue Reihenfolge wird so gespeichert, dass **die belegten Projekte ihre
  Plätze exakt behalten** (`withReorderedTail`): der Schwanz wird nur innerhalb
  der Positionen vertauscht, die er ohnehin belegte. Wer die belegten Projekte
  untereinander ordnen will, tut das weiterhin im Projekte-Tab.
- Ein Projekt wechselt die Ziehbarkeit **live** mit: sobald sein letzter offener
  Prompt fertig ist, wird sein Chip ziehbar — ohne Neuladen.

### Note
- ⚠️ Die ziehbaren Chips bekommen **kein** `touch-action: none`, obwohl ein
  Ziehgriff das sonst braucht: die Chip-Zeile ist auf dem Handy ein
  horizontaler Scroller, und die Wischgeste wegzunehmen würde die hinteren
  Projekte unerreichbar machen. Die Druckverzögerung des TouchSensors trennt
  Wischen von Ziehen.

## [0.43.0] - 2026-08-23

### Added
- **Der KI-Knopf zeigt seinen Zustand in drei Farben.** Grün eingefärbt =
  Optimierung wurde übernommen, orangenes Icon = ein Vorschlag wartet noch auf
  die Entscheidung, neutral = noch nie optimiert. Nie nur die Farbe: Symbol
  (`auto_awesome` / `rate_review` / `check_circle`) und Beschriftung wechseln
  mit — der Knopf bleibt in Graustufen und für Screenreader eindeutig.
- **`Prompt.optimization_applied_at`** — der Zustand „wurde per KI optimiert"
  war aus dem Bestand gar nicht ableitbar: nach Übernehmen UND nach Verwerfen
  stand auf der Zeile identisch `optimized=False` mit unverändertem
  `optimization_version`. Geschrieben ausschließlich von
  `decide(apply=True)`; der Bestand ist exakt aus der Entscheidungs-Historie
  nachgefüllt (`decision='applied'`), nicht geschätzt.
- **Semantische Farb-Tokens `--ok` / `--warn`** je Theme in `tokens.css`. Der
  bisherige Grünwert stand als nackter Hex im Stylesheet und war für die
  hellen Flächen viel zu hell.

### Fixed
- **Safe-Area-Insets:** die Kopfleiste stand mit `viewport-fit=cover` unter
  Statusleiste bzw. Dynamic Island — sie trägt jetzt
  `env(safe-area-inset-top)`, Kopfleiste und Inhalt zusätzlich die seitlichen
  Insets fürs Querformat.
- **Touch-Ziele auf schmalen Viewports:** Kopfleisten-Icons wurden von der
  scrollenden Reiter-Pille auf gemessene 33 px zusammengedrückt (`flex: none`,
  jetzt 44), Reiter waren 36 px hoch, Chips 36, Suchfelder nahmen nur ihre
  26 px hohe Eingabe als Trefferfläche an, Text-Links 18 px. Alles ≥ 44 px.
  Die 40-px-Knöpfe auf den Karten bleiben bewusst — sechs davon in einer
  Zeile, 44 würde umbrechen.
- **iOS-Zoom-Schutz griff nur bei `pointer: coarse`**, anders als jede andere
  Touch-Regel der Datei: ein Touch-Gerät, das einen feinen Zeiger meldet, bekam
  die 13,6-px-Textarea und damit den Zoom, aus dem iOS nicht zurückkehrt.

## [0.42.0] - 2026-08-23

### Changed
- **Die Projekt-Chips im Board sortieren sich nach offener Arbeit.** Projekte
  mit offenen Prompts stehen oben, das mit den meisten zuerst; die selbst
  gezogene Reihenfolge bleibt der Gleichstand-Entscheid und gilt weiter für
  alles mit leerer Queue. Die Reihenfolge ist aus der Prompt-Liste abgeleitet,
  ändert sich also im selben Moment wie die Zahlen — ohne Neuladen (live
  geprüft: `cue 3 · disco 2` → `disco 4 · cue 3` → zurück, ein einziger
  Seitenaufruf).
- ⚠️ **Die Chips selbst lassen sich dafür nicht mehr ziehen.** Bei einer
  abgeleiteten Reihenfolge wäre die Geste eine Lüge: das Ablegen schreibt eine
  neue `sort_order`, die Zählregel sortiert sofort darüber, und der Chip
  springt sichtbar zurück. Gesetzt wird die eigene Reihenfolge dort, wo man sie
  auch sieht — im **Projekte**-Tab, der nicht nach Zahlen sortiert.
- **KI-Optimierung gibt es nur noch für Prompts in der Queue.** Optimieren ist
  VORBEREITUNG — es schreibt den Text um, den man gleich abschickt. Sobald ein
  Prompt läuft oder fertig ist, ist dieser Text Geschichte, und ein Umschreiben
  kostet Geld für ein Ergebnis, das niemand mehr sendet. Der ✨-Knopf
  verschwindet auf Karte, Listenzeile und im Detail; „Erneut optimieren"
  ebenfalls. Ein Prompt, den man zurück in die Queue zieht, ist wieder dabei.
- **Die Regel steht im Server, nicht nur in der Oberfläche** — sonst hätte
  „Alle optimieren" weiter das ganze Board umgeschrieben: der Sammellauf nahm
  bisher JEDEN Prompt des Kontos, auch erledigte und archivierte. Er sieht
  jetzt nur die Queue, und die Meldung bei leerer Queue sagt das auch.

### Note
- Ein **wartender Vorschlag bleibt erreichbar**, auch wenn der Prompt inzwischen
  läuft: die Vergleichsansicht und die Übernehmen/Verwerfen-Leiste im Detail
  bleiben stehen. Nur das STARTEN einer neuen Optimierung entfällt.

## [0.41.0] - 2026-08-23

Jede Karte sagt jetzt, wie alt sie ist — und die Angabe bleibt von selbst
aktuell, ohne die Seite neu zu laden.

### Added
- **Relative Zeitangaben auf Karten, in der Liste und im Detail** („gerade
  eben", „vor 7 Minuten", „vor 3 Stunden", „vor 1 Tag"). Auf der Karte stehen
  Alter und Symbolleiste als ein Block unten rechts, damit die Zahl unabhängig
  von der Zahl der Tags immer an derselben Stelle steht; in der Liste hängt sie
  an der vorhandenen Meta-Zeile („Queued · cue · vor 3 Stunden"). Der
  Tooltip nennt die genauen Zeitpunkte.
- **`Prompt.edited_at`** — der Zeitstempel, den diese Anzeige meint: wann der
  INHALT zuletzt geschrieben wurde. Ein erneutes Speichern setzt die Angabe auf
  „gerade eben" zurück und markiert sie mit einem Stift; ein Verschieben, ein
  Statuswechsel, ein Lesezeichen oder ein „getestet"-Haken tun das
  ausdrücklich nicht.
- **Eine gemeinsame Uhr** (`lib/clock.ts`) treibt alle Angaben auf der Seite:
  ein Timer statt einer je Karte, und React verwirft den Neuaufbau überall
  dort, wo sich der Text gar nicht geändert hat (gemessen: 1 von 21 möglichen
  Aktualisierungen in drei Takten). Nach einem Tabwechsel wird sofort
  nachgezogen, weil Browser die Timer eines Hintergrundtabs drosseln.

### Fixed
- **Die API lieferte Zeitstempel ohne Zeitzone aus.** SQLite gibt Zeilen naiv
  zurück, frisch geschriebene sind zonenbehaftet — dieselbe Antwort enthielt
  beides. Ein Datum ohne Zonenangabe ist für jeden Browser ORTSZEIT, in Berlin
  also zwei Stunden verschoben; die Detailansicht zeigte seit jeher falsche
  Zeiten, und die neuen Altersangaben hätten alles unter zwei Stunden für immer
  als „gerade eben" gemeldet. Alle 28 Zeitfelder laufen jetzt über einen
  gemeinsamen Typ, und ein Test durchsucht das ganze Schema-Modul, damit das
  nächste Feld es nicht wieder einschleppt.
- **Die Symbolleiste der Karte wurde auf dem Handy rechts abgeschnitten**,
  sobald das Alter danebenstand — der Block bricht jetzt um.

## [0.40.0] - 2026-08-16

Fünf Fehler, gefunden über Produktionslogs, Produktionsdaten und Code — nicht
geraten, jeder mit einem Beleg.

### Fixed
- **Eine laufende Optimierung ließ beim Löschen ihres Prompts einen Sammellauf
  hängen.** Die Zeilen verschwinden mit dem Prompt (`prompt_id` ist NOT NULL,
  sie können ihn nicht überleben) — war es der letzte offene Job eines
  Sammellaufs, blieb kein Job übrig, der den Lauf hätte abschließen können:
  `finished_at` blieb leer und die Fortschrittsanzeige pollte für immer.
  Laufende Jobs werden jetzt zuerst abgebrochen, danach wird der Sammellauf neu
  ausgezählt.
- **Ein abgewiesenes Ergebnis verschwand spurlos.** Der Runner prüfte die
  Antwort auf seinen Ergebnis-POST überhaupt nicht — kein Statuscheck, kein
  Log. In den Logs: `POST /api/optimizations/11/result → 404`, nachdem der
  Prompt gelöscht worden war; eine fertige, bezahlte Optimierung war weg, ohne
  eine Zeile auf beiden Seiten. Jetzt: vorübergehende Fehler (etwa während
  eines Deploys) werden dreimal wiederholt, ein endgültiges Nein wird als
  verworfene Arbeit protokolliert — inklusive der Kosten.
- **Zwei Hintergrundschleifen schluckten jeden Fehler** (`except Exception:
  pass`). Scheitert die Anhang-Bereinigung, bleiben Screenshots über die
  30 Tage hinaus liegen, die der Composer ausdrücklich zusagt; scheitert der
  Reaper, hängen Prompts dauerhaft in „Running". Beides war von außen nicht zu
  bemerken. Jetzt mit Traceback, höchstens einmal pro Minute.
- **Die Statistik zeigte nach Umbenennungen bis zu zwei Minuten alte Namen.**
  Der Cache wurde nur von Prompt-Ereignissen verworfen; ein umbenanntes Projekt
  oder Tag erreichte ihn nie, und Neuladen im Browser half nicht, weil die
  Veralterung auf dem Server saß. Der Schlüssel enthält jetzt den
  Datenfingerabdruck des Kontos — es gibt keinen Schreibpfad mehr, der daran
  denken muss.
- **`HEAD` antwortete mit 405**, auch auf `/api/health`: FastAPIs `APIRoute`
  ergänzt HEAD nicht automatisch. Ein Uptime-Monitor, der HEAD verwendet, hätte
  die Seite als tot gemeldet.

### Changed
- **Deploys zeigen eine Seite statt eines Fehlers.** Der Container-Austausch
  lässt den Port rund vier Sekunden geschlossen — gemessen; ohne einen zweiten
  parallelen Container ist das nicht wegzubekommen. Statt nginx' nacktem 502
  kommt jetzt „cue startet gerade neu", die sich selbst neu lädt (mit ehrlichem
  Statuscode und `Retry-After`). API-Aufrufe bekommen weiterhin nur einen
  Statuscode, kein HTML. Dazu `ops/deploy.sh`, das erst zurückkehrt, wenn der
  neue Container gesund antwortet.


## [0.39.2] - 2026-08-15

### Added
- **Vier Testsuiten, die eine Eigenschaft der gesamten Oberfläche prüfen** statt
  einzelner Aufrufstellen — gegen die Fehlerklasse, die niemand einbaut,
  sondern bei der jemand eine Regel schlicht nicht anwendet. 148 neue Tests
  (744 → 892).
  - **Mandantentrennung strukturell**: läuft über jede Route der App und fällt,
    sobald eine weder auf den Mandanten eingeschränkt ist noch eine Maschine
    authentifiziert noch mit schriftlicher Begründung auf der Ausnahmeliste
    steht. Dazu: jede verändernde Route braucht den CSRF-Wächter, und ein
    zweites Konto bekommt auf jede fremde Ressource **404, nie 403** — ein
    „verboten" bestätigt, dass die Zeile existiert.
  - **Sortier-Kontrakt zwischen Server und Client**: `contracts/column-order.json`
    beschreibt zehn Fälle, beide Sprachen rechnen sie mit ihrer eigenen
    Implementierung durch. Aus der Bitte „ändere beide Seiten zugleich" wird
    etwas, das rot wird. Ein Attrappen-Objekt schlägt außerdem Alarm, sobald
    die Sortierung ein Feld liest, das per Drag nicht änderbar ist.
  - **Signierte Token**: fast ausschließlich Negativfälle (manipuliert,
    abgeschnitten, fremd signiert, abgelaufen, zweckentfremdet). Eine gültige
    Signatur IST hier die Berechtigung; ein kaputter Prüfschritt fällt im
    Normalbetrieb nicht auf.
  - **Markdown-Vorschau**: das Ergebnis wird mit einem echten DOM geparst — kein
    Element außerhalb des erlaubten Satzes und **kein einziges Attribut**, was
    erst rechtfertigt, Anführungszeichen ungeschützt zu lassen. Umgekehrt muss
    die Nutzlast **lesbar bleiben**: ein Prompt über XSS soll die Vorschau
    überleben.

### Fixed
- Der Testhelfer für Mandantenwechsel überschrieb still die Sitzung im
  gemeinsamen Cookie-Speicher — ein Test, der zurückwechselte, prüfte als
  falscher Nutzer und wäre aus dem falschen Grund grün gewesen.


## [0.39.1] - 2026-08-14

### Fixed
- **Das Optimierungsmodell ist jetzt festgelegt** (`OPTIMIZE_MODEL=opus`).
  Vorher war die Variable leer, es wurde kein `--model` übergeben — gerechnet
  hat also das, worauf die Claude-Code-CLI auf dem Runner-Mac gerade
  eingestellt war. Ein `/model` dort änderte still mit, womit Prompts
  umgeschrieben werden; die Historie zeigt entsprechend zwei Modelle
  (fünf Läufe Opus 5, drei Läufe Fable 5) ohne Zutun des Nutzers.
  Sämtliche `OPTIMIZE_*`-Schalter fehlten außerdem komplett in
  `.env.example` — nachgetragen.

### Added
- Tests für den Weg der Einstellung bis in die CLI-Argumentliste: die
  konfigurierte Angabe erreicht den Runner, eine leere bleibt leer (statt zu
  einem im Code verdrahteten Standard zu werden), Alias und vollständiger
  Name reisen unverändert, und die Historie hält fest, welches Modell
  **geantwortet** hat — nicht, welches angefragt wurde.


## [0.39.0] - 2026-08-12

### Added
- **Live-Aktualisierung zwischen Geräten.** Was auf dem Telefon entsteht,
  erscheint am Rechner ohne Neuladen — und umgekehrt. Jeder Browser hält dafür
  genau eine Anfrage offen (`GET /api/changes`), die antwortet, sobald sich
  etwas ändert, und bis dahin nichts kostet; gemessene Verzögerung 0,18 s. Der
  Cursor ist ein Fingerabdruck der Daten, kein mitgeführter Zähler: es gibt
  keinen Schreibpfad, den man vergessen kann. Im Hintergrund ruht die
  Schleife und holt beim Zurückkehren in einer Anfrage auf.

### Changed
- **Dialoge auf dem Telefon sind Bottom-Sheets.** Volle Breite, an der
  Unterkante verankert, oben abgerundet, Safe-Area berücksichtigt — eine Regel
  für alle neun Overlays. Der Composer gewinnt 50 px Inhalt, die Detailansicht
  94 px, weil die fünf Status-Chips statt über drei Zeilen in einer
  scrollbaren Reihe stehen.

### Fixed
- **Die Tastatur verdeckt die Knöpfe nicht mehr.** Mit einer 290-px-Tastatur
  lag „Anlegen" bisher 234 px hinter den Tasten. Android bekommt
  `interactive-widget=resizes-content`, iOS die `visualViewport`-Messung —
  beide Wege nachgestellt und verifiziert.
- **Kein Hineinzoomen auf iOS mehr.** Das Prompt-Feld maß 13,6 px; Safari
  zoomt unter 16 px die ganze Seite hinein und nicht wieder heraus.
- **Status-Chips klappten auf 2 px zusammen**, sobald sie nicht mehr umbrachen:
  dem Detail-Sheet fehlte die `flex-shrink: 0`-Regel, die der Composer hat.
- **`tsc -b` legte ein kompiliertes `vite.config.js` neben die `.ts`-Datei**,
  das Vite bevorzugt lädt — seit einem Monat wurde jede Änderung an der
  Vite-Konfiguration still ignoriert.


## [0.36.0] - 2026-07-31

### Added
- **Bug-tagged prompts land at the top of the queue on create.** Tags whose
  name starts with `bug` (case-insensitive — `bug`, `bugfix`, `bug-report`, …)
  use the same `_top_sort_order` placement as a freshly finished done-prompt.
  Non-queued creates and later tag edits are unaffected; drag still works.

### Fixed
- **Optimize error messages.** The Claude CLI writes API failures (weekly
  quota, auth, 429) into the stdout JSON envelope and often leaves stderr
  empty — even on exit 1. The runner now surfaces that message in the UI
  instead of the opaque „CLI beendet mit Exit-Code 1", and skips pointless
  retries on quota/auth failures.


## [0.21.1] - 2026-07-19

### Changed
- **Snippets sort alphabetically — manual reordering removed.** Snippets
  inside each group now sort by abbreviation (case-insensitive), exactly like
  Inspector Rust, so both sides of the sync show the same order. Row drag
  handles and drag-to-move are gone (a manual order would be overridden by
  the sort anyway); moving a snippet to another group still works via the
  editor's group field or the multi-select "Verschieben nach…" action.
  Group headers remain drag-sortable.

## [0.21.0] - 2026-07-19

### Added
- **Automatic bidirectional snippet sync with Inspector Rust.** IR polls new
  token-guarded endpoints (`GET/POST /api/sync/snippets`, per-user
  `snippet_sync_token`) every 60 s and after every snippet mutation; both
  sides apply the same deterministic merge (higher version wins content;
  equal versions + identical content = no-op; equal-version conflicts go to
  cue; grouping always follows cue — it is the organizational master).
  **Deletions propagate via tombstones** (`snippet_tombstone` table, 90-day
  TTL): deleting or renaming-away an abbreviation records `{abbreviation,
  version}`; the peer deletes its copy only if it isn't newer (a later edit
  beats the deletion), and recreations start above the tombstone so they
  survive the next cycle. The **sync scope is configured only in cue**: a
  ☁️-toggle in every snippet-group header (plus one on „Ohne Gruppe")
  controls which groups participate; Settings → „Snippet-Sync (Inspector
  Rust)" generates the token and shows the last sync time. Verified
  end-to-end against a real IR sync cycle (live HTTP, convergence after one
  cycle, second cycle no-op).

## [0.20.0] - 2026-07-18

### Added
- **One-click duplicate on cards and list rows** — a new duplicate button
  (⧉, next to the copy button) clones a prompt without opening the detail
  view. `POST /prompts/{id}/duplicate` gained an `in_place` mode: unlike the
  existing copy-to-project (which always lands queued in the target), an
  in-place duplicate copies EVERYTHING where it is — same project, same
  status, tags, blocked flag, bookmark (appended to the bookmarks section),
  cloned screenshot files — and titles the copy with an incrementing counter:
  `Titel` → `Titel (2)` → `Titel (3)`. The copy shares the source's
  `sort_order`, so it appears directly below the original in its column.
  `tested` and `ran_at` are deliberately not inherited (a duplicate hasn't
  been verified; done/running copies get a fresh `ran_at`).

## [0.19.1] - 2026-07-17

### Fixed
- **Mobile topbar was unusable** — with seven tabs the header overflowed the
  viewport and pushed the theme/settings icons off-screen. The tab pill now
  scrolls horizontally on its own (hidden scrollbar) while brand and action
  icons stay fixed and visible; the keyboard-shortcuts button is hidden on
  touch widths (pointless there) and the spacer collapses. Verified down to
  320 px with no page-level horizontal scroll.

## [0.19.0] - 2026-07-15

### Changed
- **Snippet version travels the IR roundtrip** (protocol shared with Inspector
  Rust): the export envelope now carries an ADDITIVE `version` field per
  snippet (older IR builds ignore unknown keys — fully backward compatible),
  and the import merges with the shared rule: content differs →
  `max(incoming, local + 1)`, content identical → `max(incoming, local)`,
  missing/0 → treated as 1. Re-importing cue's own export is a no-op; both
  sides converge on the same number after every roundtrip. Supersedes
  0.17.0's "cue-internal only" stance.

## [0.18.4] - 2026-07-15

### Added
- Tag autocomplete: `improvement` added to the change-type tags.

## [0.18.3] - 2026-07-15

### Changed
- **New app icon/logo**, aligned with the celox tool family (token-tracker,
  celox-ops, code-bridge): near-black rounded tile with hairline border and a
  single vivid accent motif — fading queue lines (waiting prompts) plus a
  lavender bolt (execution). Applied everywhere: favicon (cache-busted
  `?v=2`), PWA icons 192/512 + maskable (safe-zone scaled), topbar + login
  logo, the OG share thumbnail, and all regenerated screenshots (README +
  landing).

## [0.18.2] - 2026-07-14

### Changed
- **Badge automation expanded**: the README now carries 11 dynamic badges,
  all computed from real sources on every `npm test` — version (synced from
  `backend/app/main.py`), tests total + per suite, backend/runner **coverage**
  (parsed from `pytest --cov`, threshold-colored), LOC total + Python/
  TypeScript split, and the API-endpoint count. Marker-based in-place
  replacement (`<!-- badges:dynamic -->`), idempotent. Static badge rows
  extended (pytest, Vitest, TanStack Query, dnd-kit, Motion, Material 3,
  Google OAuth, Conventional Commits, self-hosted).
- **README screenshots regenerated** with the fictional demo content
  (board, prompt detail, runs, snippet workbench, grouped list, mobile,
  light theme) — reproducible via the seeded-demo screenshot pipeline.

## [0.18.1] - 2026-07-14

### Added
- **Social sharing**: full Open-Graph + Twitter-Card meta tags (title,
  description, locale, canonical) and a branded **1200×630 share thumbnail**
  (`/og.png`, ~230 KB — WhatsApp-friendly) rendered from the app's design
  language (bolt logo, tagline, mini board illustration). Excluded from the
  PWA precache.

## [0.18.0] - 2026-07-14

### Added
- **Landing page for signed-out visitors**: below the (unchanged, top-priority)
  login card, a "Was cue kann" section explains the main features — board,
  runs and the IR snippet workbench with real app screenshots showing
  fictional demo content (webshop/mobile-app sample prompts, demo snippets),
  plus a chip row for the remaining features. Screenshots live under
  `/landing/` and are lazy-loaded, deliberately excluded from the PWA
  precache.

## [0.17.1] - 2026-07-14

### Fixed
- Snippet list: the version badge now sits flush right in each row (the title
  did not expand — `.grow` was scoped to list items only), version + copy
  button align at the row's right edge.

## [0.17.0] - 2026-07-14

### Added
- **Snippet versioning**: every snippet carries a version number (badge in the
  list row and the editor header). New and existing snippets start at **v1**;
  saving a CONTENT change (abbreviation, title or body — also via import
  merge) bumps it by 1. Organizational actions (group moves, drag reorder,
  bulk move) and no-op saves deliberately do not bump. cue-internal only —
  the IR export envelope stays byte-identical.

## [0.16.0] - 2026-07-14

### Added
- **In-app user approval (admin)**: sign-in via Google is now open — new users
  land in a "wartet auf Freischaltung" state (data APIs return 403, a waiting
  screen with logout is shown) instead of being rejected. The owner
  (`OWNER_EMAIL`) gets a **Nutzerverwaltung** section in Settings listing
  pending and approved accounts with Freischalten/Sperren (revoke locks the
  user out on their very next request — the approval check sits in the
  central `current_user_id` dependency). Allowlisted emails/domains and the
  owner are auto-approved on login; existing users were backfilled as
  approved. New endpoints: `GET /api/admin/users`,
  `PATCH /api/admin/users/{id}` (owner-only; self-lockout blocked).

## [0.15.7] - 2026-07-14

### Fixed
- Tag autocomplete: the change-type category was missing the most obvious
  entries — added `fix`, `bugfix`, `quickfix` and `workaround`.

## [0.15.6] - 2026-07-14

### Changed
- **Platform-correct save-shortcut hint**: the Speichern/Anlegen buttons in the
  prompt composer and the snippet editor now show ⌘↵ on macOS and Strg+↵ on
  Windows/Linux (`lib/platform.ts`, unit-tested). The handlers keep accepting
  BOTH modifiers on every platform — so if a system-wide macOS shortcut ever
  hijacks Cmd+Enter, Ctrl+Enter still saves.

## [0.15.5] - 2026-07-14

### Changed
- **Tag autocomplete: full-spectrum list** — another ~520 categorized entries
  (languages, frameworks, protocols/networking, systems/low-level, build
  tooling, editors, hardware/IoT, game dev, audio/video, docs, business/
  product, reliability/ops, data engineering, auth/identity, UI content,
  APIs/integration), total now ~1100. American spelling enforced by a new
  unit test (no -isation/colour/behaviour/…), list stays duplicate-free.
- Data fix: the typo tag `opimization` on 18 prompts was corrected to
  `optimization` (deduped where both were present).

## [0.15.4] - 2026-07-13

### Changed
- **Tag autocomplete: curated list massively extended** — ~500 new categorized
  software-development tags (UI components, UX/interaction incl. transition/gui,
  frontend/backend tech, security, testing, DevOps/cloud, AI, mobile, process,
  code quality, general engineering), programmatically deduplicated; a unit
  test now guarantees the list stays free of case-insensitive duplicates and
  single-token lowercase.

## [0.15.3] - 2026-07-13

### Changed
- **Tested prompts sink in Done**: toggling the tested icon on a Done card
  springs it below the untested ones; within the tested block cards sort by
  execution time (most recently run on top). Board, list view and keyboard
  navigation share one ordering (`lib/order.ts`, unit-tested).

## [0.15.2] - 2026-07-12

### Added
- The **cue brand** in the top-left header is clickable and reloads the page
  (hover tint + press feedback).

## [0.15.1] - 2026-07-12

### Added
- **Custom dialogs everywhere**: new reusable `InputDialog` (MD3, autofocus,
  Enter/Esc, inline validation) replaces the last native `window.prompt()`
  calls (create/rename snippet group — now with a live duplicate check);
  deleting snippets (single from the editor, bulk from the selection bar)
  asks via the app's own `Confirm` dialog including a merge-semantics
  reminder. Project convention: no native browser dialogs.
- **Snippet management polish**: search field (abbreviation/title/body,
  umlaut-safe, hides empty groups while searching), visible **select mode**
  with checkboxes and a per-group select-all toggle (Cmd/Ctrl+click still
  works), drag **handles** on rows and group headers (no more click-vs-drag
  ambiguity; dragging pauses during search/selection), and a **copy button**
  per row that puts the snippet body on the clipboard.

## [0.15.0] - 2026-07-12

### Added
- **Snippet library** — an editing workbench for Inspector-Rust (IR) AI-prompt
  snippets with a lossless roundtrip: import an IR backup JSON, structure and
  edit the snippets in cue (groups collapsible + drag-sortable, snippets
  draggable across groups, multi-select bulk move/delete, editor with
  monospace abbreviation field + live duplicate check and Markdown preview),
  export back as an IR backup that "Settings → Backup & restore → Import"
  reads. New **Snippets** tab.
  - Format contract in `app/ir_format.py` (pure, tested incl. a golden
    roundtrip against a real IR fixture): version 2 envelope, unix-millis
    timestamps, `abbreviation` as merge key (verbatim, trim only), groups by
    NAME with empty groups + order in `snippet_categories`, three-valued
    `category` (`"name"` assign / `""` explicitly ungroup / `null` leave IR's
    assignment untouched) — cue exports `""` for ungrouped, never `null`.
  - Read-side tolerance: full envelope, snippets-only backups, the legacy
    `[{abbreviation,title?,body}]` format (lands ungrouped); encrypted
    backups are rejected with a clear message. Per-row errors are collected,
    never fatal. Import merges (upsert per abbreviation); `category: null`
    does not clobber a cue-side group move.
  - New tables `snippet` + `snippet_group` (per-tenant, abbreviation unique
    per user), full CRUD/reorder/bulk API under `/api/snippets`, partial
    export via `?groups=a,b`.
  - The UI carries a permanent hint that IR imports MERGE: deletions and
    abbreviation renames in cue do not delete/rename in IR.

## [0.14.3] - 2026-07-12

### Changed
- **Remaining test gaps closed** (backend 90 → 117 tests, coverage 96 % → 99 %;
  runner 56 → 65 tests, 81 % → 91 %): capture edge/error paths (blank prompts,
  empty bearer token, non-deliverable sessions, terminal context cleared after
  enqueue, settings for a deleted user), run lifecycle edges (blocked prompts
  stay queued on run create, cancel keeps manually-moved prompts, heartbeat on
  terminal runs), server-side prompt filters, expired-attachment tolerance
  (serve 404, GC + duplicate skip missing files), forged-session/uid guards,
  SPA fallbacks without index/static dir, idempotent DB migration, the OAuth
  urllib helpers — and the runner's orchestration loops (delivery/capture
  loops survive poll errors and always resolve claims, run_forever executes
  claims concurrently under MAX_CONCURRENCY and shuts down cleanly on SIGTERM,
  runner errors report the run as failed) plus every tmux/osascript delivery
  failure stage.

## [0.14.2] - 2026-07-12

### Added
- **Badge automation**: `scripts/update-badges.mjs` keeps the README's LOC and
  test-count badges current — LOC counted over source only (tests, generated
  files and dependencies excluded), test counts parsed from the real runners
  (`pytest --collect-only`, `vitest list`). Wired as `npm run update-badges`
  plus a `posttest` hook in a new root `package.json` (`npm test` runs all
  three suites).
- **Frontend unit tests** (Vitest, new): 53 tests over `src/lib` — escape-first
  markdown rendering (XSS), tag normalization/dedup, tonal color generation,
  API client CSRF handling, clipboard/speech wrappers, motion presets.

### Changed
- **Test suite maxed out**: backend 34 → 90 tests (coverage 84 % → 96 %; OAuth
  callback flows, session/CSRF/state primitives, project CRUD + tenant
  isolation, SPA path-traversal guard, security headers, attachment guards,
  merge/import/export edge cases, run-log pagination), cue-runner 22 → 56
  tests (coverage 59 % → 81 %; API client via httpx MockTransport, config
  parsing, stream >64-KiB events, delivery edge cases). No behavior changes.
- Shared backend test fixtures extracted into `backend/tests/conftest.py`.

## [0.14.1] - 2026-07-12

### Changed
- **Playbook step order follows the board**: the run dialog now initializes
  its steps in the Queued column's order (top to bottom, `sort_order`), no
  matter in which order the prompts were selected. ↑/↓ still allow manual
  overrides before starting.

## [0.14.0] - 2026-07-12

### Added
- **Board mirrors run execution**: creating a run moves all its source
  prompts into the Running column (stamps `ran_at` on first entry; blocked
  prompts are skipped). Finished steps already moved prompts — success →
  top of Done, failure → Failed — so the full lifecycle is now visible on
  the board. When a run ends without executing all steps (cancel while
  queued, stop-on-error failure, runner timeout via the reaper), the
  prompts of never-executed steps return to the queue instead of being
  stranded in Running.

## [0.13.0] - 2026-07-12

### Added
- **Run step progress**: the run list API (`GET /runs`) now carries
  `steps_done`/`steps_total` per run (steps in a terminal state vs. all
  steps). The run ticker overlay shows it for playbooks ("Playbook läuft… ·
  4/5 abgeschlossen", aggregated across runs when several are active), and
  the Runs tab shows a "4/5" chip in each playbook's header row.

### Changed
- **Active runs expanded by default**: on the Runs tab, queued/claiming/
  running runs open their detail (steps, live log, cancel) automatically;
  clicking the header still toggles, and a manual toggle wins over the
  default. Several runs can now be open at the same time (each open card
  fetches and polls its own detail).

## [0.12.1] - 2026-07-12

### Fixed
- **Cmd/Ctrl+Enter save in the composer**: the shortcut silently did nothing
  when any earlier keydown listener (e.g. a browser extension) called
  `preventDefault()` on the combo — the handler yielded to `defaultPrevented`.
  Capture and backup handler now coordinate through a WeakSet of handled
  events instead, so the save always fires exactly once. Additionally:
  `Cmd/Ctrl+S` saves too (fallback when something outside the page swallows
  Cmd+Enter), an empty prompt body shows an error toast instead of silently
  ignoring the shortcut, and an in-flight guard prevents duplicate prompts
  from rapid repeated presses.

### Changed
- **Blocked only for queued prompts**: the blocked toggle is now rendered only
  on queued prompts (cards, list rows, detail — analogous to the tested
  toggle on running/done). The server rejects `blocked=true` on non-queued
  prompts (400) and clears the flag whenever a prompt leaves the queue (PATCH
  and reorder); a one-time idempotent migration clears stale flags on
  existing data.

## [0.12.0] - 2026-07-12

### Added
- **Blocked status**: new toggle (left of the bookmark icon on cards, list
  rows and the detail). Blocked prompts are grayed out, sink to the bottom of
  their column, cannot be dragged and refuse running/done (client- and
  server-side 400) until unblocked; "Ausführen" is hidden for them.
- **Runs move prompts to Done**: a successfully finished run step moves its
  source prompt to Done (top of the column); a failed step moves it to Failed.
- **Run status overlay**: a floating pill (bottom left) shows active runs
  everywhere in the app — click opens the Runs tab; when a run finishes the
  board refreshes automatically and a toast reports the outcome.
- **Active project in the header**: the board view labels the selected
  project (or "Alle Projekte" / "Ohne Projekt") next to the cue brand, with a
  spring entrance on every change.
- **Column cap**: board columns show at most 10 cards; more are collapsed
  behind a per-column "+N weitere anzeigen" expander (the first 10 stay
  visible).
- Parallel runs: the Mac runner already supported it — `MAX_CONCURRENCY` in
  `cue-runner/.env` is now set to 3, so up to three runs (each its own Claude
  session) execute simultaneously.

### Changed
- **Done goes on top**: moving a prompt to Done (status chips, keyboard `3`,
  drag into the column, or a finished run) now always places it at the TOP of
  the Done column.

### Fixed
- Cmd/Ctrl+Enter in the composer is now double-hardened: the window listener
  runs in the capture phase (nothing can swallow the event first) and the
  sheet keeps a bubble-phase backup handler (guarded against double-saving).

## [0.11.1] - 2026-07-12

### Changed
- Multi-select on cards/rows now uses **Cmd/Ctrl+click** instead of
  Shift+click (Shift+click behaves like a plain click again). Note: on macOS
  Ctrl+click is the system right-click — use Cmd there.

## [0.11.0] - 2026-07-12

### Added
- **Shift+click multi-select** on board cards and list rows: the first
  shift+click selects a prompt and brings up the action bar (Löschen /
  Ausführen / Zusammenführen), further shift+clicks toggle prompts in and out
  of the selection; deselecting the last one dismisses the bar. The explicit
  "Auswählen" mode keeps working as before.

### Fixed
- The selection action bar now disappears immediately when selection ends —
  its AnimatePresence exit never visibly played (the bar froze ~2 s at full
  opacity, then popped away). Spring entrance stays; removal is instant.

## [0.10.0] - 2026-07-12

### Added
- **Run dialog remembers its settings**: project base, model, permission mode,
  allowed tools, and the switches (stop on error, bare, skip permissions) are
  restored from the last run when the dialog opens (`localStorage`
  `cue-run-prefs`, validated against the server whitelists). Only the
  **subfolder** intentionally starts empty each time.

## [0.9.0] - 2026-07-12

### Added
- **Voice dictation in the Composer**: a mic chip next to the prompt field
  records speech via the browser-native Web Speech API and appends finalized
  phrases to the prompt body (live interim readout below the textarea, red
  pulsing indicator while recording). Auto-restarts across Chrome's silence
  timeout; stops on preview switch, save, and close. Browsers without the API
  (Firefox) don't show the button. `Permissions-Policy` now allows
  `microphone=(self)`.

## [0.8.0] - 2026-07-12

### Added
- **Animated theme switch** (like celox.io): toggling light/dark reveals the
  new theme as an expanding circle from the click point via the View
  Transitions API (900 ms desktop, 520 ms on small/touch screens, emphasized
  ease-out). Works from the topbar toggle and the theme chips in Settings;
  keyboard activation reveals from the button's center. Falls back to an
  instant switch without API support or under `prefers-reduced-motion`.

## [0.7.1] - 2026-07-12

### Changed
- **Verlauf: newest prompts first.** The prompt timeline inside an expanded
  session now lists captured prompts newest-first (`GET /sessions/{id}` orders
  by `seq` descending) — previously new entries were appended at the bottom.

## [0.7.0] - 2026-07-12

### Added
- **Double-click to edit**: double-clicking the content in the prompt detail
  (rendered preview or raw text) opens the edit dialog; double-clicking the
  Markdown preview inside the composer switches back to the editor with the
  textarea focused.

### Fixed
- **Cmd/Ctrl+Enter saves the composer again regardless of focus.** Clicking a
  non-focusable area (e.g. the rendered preview) moved keyboard focus to
  `<body>`, where the save shortcut — previously bound to the sheet element —
  never fired. It now lives on a window-level listener while the dialog is open.

## [0.6.0] - 2026-07-10

### Added
- **Project badge menu in the prompt detail**: clicking the project badge opens
  a popover to **move** the prompt to another project (or "Kein Projekt") or to
  **copy** it into another project. Prompts without a project show a subtle
  "Kein Projekt" badge so the menu stays reachable. Escape / outside click
  closes just the menu (the sheet stays open).
- New endpoint `POST /prompts/{id}/duplicate {project_id}`: clones title, body
  and tags — **screenshots are duplicated on disk** so the copy owns its files
  independently — and the copy always lands as **Queued** in the target project.

## [0.5.1] - 2026-07-09

### Fixed
- Capture project fallback (no git repo at/above the cwd) now also skips
  `_`-prefixed grouping folders — a session started directly in
  `_customers/celox` lands in project "celox", not "_customers". Existing
  `_customers` sessions were migrated to their per-customer projects.

## [0.5.0] - 2026-07-09

### Added
- **Projekt-Chips im Board sortierbar**: the project filter chips above the
  board/list can now be drag-reordered in place (same order source as the
  Projekte view — `Project.sort_order`); "Alle" / "Ohne Projekt" stay fixed.
- **Precise capture project derivation via git root**: the capture hook now
  reports the cwd's git repo root, and cue derives the project name from it
  relative to the base with `_`-prefixed grouping folders skipped — so repos
  under `_customers/` become separate projects (`celox/website`,
  `boarding-m/website`, `hus-ic`, …) instead of all lumping into one
  `_customers` project. Fully backward-compatible: items without `git_root`
  (old hook, no repo) keep the first-segment fallback, existing projects and
  sessions are untouched.

## [0.4.2] - 2026-07-02

### Fixed
- Deleting a capture session that had a "send to CLI" delivery no longer
  crashes with a FK 500 — `CliDelivery` rows are removed first, and the child
  deletes are flushed before the parent (also fixes the same latent ordering
  issue for sessions with captured prompts).
- The runner strips ESC/control bytes from delivered text, so a prompt can't
  smuggle a bracketed-paste terminator (`ESC[201~`) that would end paste mode
  early and run the remainder as live keystrokes/commands.
- The runner now reports a `failed` result if a delivery transport raises
  (missing `osascript`/`tmux`, oversized argv, …) instead of silently orphaning
  the claimed delivery; and each `osascript`/`tmux` call has a 20 s timeout so a
  hung terminal (or the first-run Automation-permission dialog) can't wedge the
  whole delivery loop.
- The terminal context is now fully refreshed on every captured prompt (stale
  iTerm GUID / recyclable tmux pane is cleared when a session resumes elsewhere),
  so a delivery can't be routed into an unrelated terminal.
- A delivery stuck in `sending` (runner died mid-flight) is reaped to `failed`
  on the next claim instead of lingering forever.
- `SendToSessionDialog`: closing the dialog while a send/poll is in flight no
  longer updates state after unmount or fires a stray toast seconds later.

## [0.4.1] - 2026-07-02

### Fixed
- Tags are now deduplicated case-insensitively per prompt — the tag input
  refuses to add a tag the prompt already has, and tags are deduped on save and
  on render, so a tag (e.g. `optimization`) can never appear twice on a prompt.
- Editing a prompt: clicking outside the dialog no longer closes it (avoids
  losing edits by an accidental click on the backdrop). Close via the ✕,
  "Abbrechen", or Esc. Creating a new prompt still closes on outside click.

## [0.4.0] - 2026-07-02

### Added
- **Send a prompt into a live CLI session** — the reverse of prompt capture.
  From a prompt's detail view (owner-only), pick a running Claude-Code session
  and cue types the prompt into that terminal, either just inserting it or
  submitting it (Enter). Implemented over the existing runner:
  - The capture hook now records the session's terminal context
    (`ITERM_SESSION_ID` / `TMUX`), so cue knows which terminal each Claude
    session lives in; `CaptureSession` gains `deliverable` when it's reachable.
  - New `CliDelivery` queue: `POST /api/sessions/{id}/send` (owner) enqueues,
    the runner claims via `GET /api/cli/claim` and reports via
    `POST /api/cli/{id}/result`.
  - Runner transport layer (`cue_runner/deliver.py`): **iTerm2** (AppleScript
    `write text`) and **tmux** (`paste-buffer`), both using **bracketed paste**
    so multi-line prompts land as literal input; ids validated, argv-only (no
    shell/AppleScript injection).
  - `SendToSessionDialog`: picks the most relevant live session (prompt's
    project first), "und ausführen" toggle (default off), polls for the result.

### Note
- iTerm2 automation needs a one-time **Automation permission** (System Settings
  → Privacy & Security → Automation) for the process running the runner.

## [0.3.2] - 2026-07-02

### Fixed
- Deleting (or merging away) a prompt that had been executed in a run no longer
  crashes with a 500 — the `RunStep.prompt_id` foreign key is detached first
  (the step keeps its text snapshot).
- Deleting a project that has capture sessions no longer crashes with a 500 —
  `CaptureSession.project_id` is unassigned alongside the project's prompts.
- Composer: removing an already-saved screenshot and then pressing **Abbrechen**
  no longer deletes it permanently; existing attachments are only deleted on a
  successful save, uncommitted uploads still get cleaned up on cancel.

### Security (cue-runner hardening — defense-in-depth vs. a compromised server)
- `allowed_tools` tokens starting with `-` are rejected, so a malicious server
  can't smuggle extra `claude` CLI flags (e.g. `--dangerously-skip-permissions`).
- The `claude` subprocess no longer inherits the runner's `RUNNER_TOKEN` /
  `CAPTURE_TOKEN` (or `CUE_*` config) — a run step can't read them from its env.
- Steps run in their own process group (`start_new_session`); cancel/timeout now
  signals the whole tree, so tool-spawned grandchildren aren't orphaned.
- The project path is re-validated after `realpath`, closing a symlink escape of
  the base whitelist.
- The stream-json reader tolerates events larger than 64 KiB and surfaces reader
  errors as a failed step instead of a false success.

## [0.3.1] - 2026-07-02

### Changed
- **Verlauf** now shows **one collapsible card per project** (project summary:
  session + prompt counts, latest activity) with the individual capture sessions
  as expandable subgroups inside — instead of a flat list of session cards under
  a project heading.

## [0.3.0] - 2026-07-01

### Added
- **Prompt capture** — a Claude Code `UserPromptSubmit` hook logs every prompt
  you type in the CLI into cue via the cue-runner's forwarder (spool → batched,
  dedup-safe upload).
  - New **Verlauf** view: capture sessions grouped by project → prompt timeline,
    with copy and **promote-to-queue**; session delete.
  - The project is derived from the working directory under a configurable base.
  - **Multi-tenant**: per-user capture token + project base (Settings →
    Prompt-Capture); the runner sets `CUE_NO_CAPTURE=1` on its own runs.
- Drag-to-reorder projects (order drives the filter chips).

## [0.2.0] - 2026-06-29

### Added
- **Run engine** — execute saved prompts through the Claude Code CLI via a
  Mac-side runner (`cue-runner/`) that polls cue, atomically claims runs, runs
  them headless (`claude -p --output-format stream-json`), and reports results.
  - **single** (one prompt) and **chain**/playbook (ordered prompts in one Claude
    session via `--session-id`/`--resume`) runs.
  - Owner-only **Runs** tab with status badges, live log tail, copyable session
    id, cost, step breakdown, **cancel** and **re-run**.
  - `RunDialog` with whitelisted project path, model, permission-mode, allowed
    tools, bare mode, skip-permissions (warned), stop-on-error.
  - Project-path whitelist (server + runner), `RUNNER_TOKEN` auth, atomic claim,
    heartbeat, and a stale-run reaper.

## [0.1.0] - 2026-06-28

First public release.

### Added
- Multi-tenant prompt queue with **Google OAuth** login and per-user data
  isolation (email/domain allowlist).
- **Kanban board** with drag-between-columns status changes + reorder, and a
  status-grouped, collapsible **list view** with subtle status colors.
- **Composer** with Markdown editor, live preview, autosave draft, tag
  autocomplete (curated dev tags + previously used), and last-project preselect.
- **Bookmarks** section with drag-and-drop ordering.
- **"Tested"** toggle for running/done prompts.
- **Merge** several prompts into one (reorder, format, originals delete/archive/keep).
- **Delete with undo** (single + bulk via multi-select).
- **Screenshot attachments** via drag-and-drop, paste, or file picker — with a
  lightbox viewer and **automatic deletion after 30 days**.
- One-click copy to clipboard, import (`.txt`) / export (JSON, ZIP).
- Material Design 3 Expressive UI with spring motion, light/dark/system themes,
  dynamic color, full keyboard shortcuts, and PWA support.
- Mobile-optimized, no-horizontal-scroll responsive layout.

[0.7.0]: https://github.com/pepperonas/cue/releases/tag/v0.7.0
[0.6.0]: https://github.com/pepperonas/cue/releases/tag/v0.6.0
[0.5.1]: https://github.com/pepperonas/cue/releases/tag/v0.5.1
[0.5.0]: https://github.com/pepperonas/cue/releases/tag/v0.5.0
[0.4.2]: https://github.com/pepperonas/cue/releases/tag/v0.4.2
[0.4.1]: https://github.com/pepperonas/cue/releases/tag/v0.4.1
[0.4.0]: https://github.com/pepperonas/cue/releases/tag/v0.4.0
[0.3.2]: https://github.com/pepperonas/cue/releases/tag/v0.3.2
[0.3.1]: https://github.com/pepperonas/cue/releases/tag/v0.3.1
[0.3.0]: https://github.com/pepperonas/cue/releases/tag/v0.3.0
[0.2.0]: https://github.com/pepperonas/cue/releases/tag/v0.2.0
[0.1.0]: https://github.com/pepperonas/cue/releases/tag/v0.1.0
