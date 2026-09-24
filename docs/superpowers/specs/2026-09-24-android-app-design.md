# cue für Android — Entwurf

*Stand 2026-09-24. Freigegeben im Gespräch; dieser Text ist die Grundlage für den
Umsetzungsplan.*

## 1 · Zweck und Abgrenzung

Eine kleine native Android-App, mit der Prompts **unterwegs gelesen, gesucht,
kopiert, angelegt und bearbeitet** werden. Sie ist offline benutzbar.

Sie treibt **keine** Läufe, tippt in **keine** CLI-Sitzung, stößt **keine**
Optimierung an und kennt weder Statistik noch Snippets noch Nutzerverwaltung.
Das ist keine Sparfassung, sondern die tragende Entscheidung dieses Entwurfs —
siehe § 3.

## 2 · Verworfene Alternative: die Capacitor-Hülle

Der erste Entwurf folgte `kiez-finder`: eine Capacitor-Hülle, die
`https://cue.celox.io/?native=1` lädt. Eine Codebasis, voller Funktionsumfang,
Web-Deploys wirken sofort. Verworfen aus drei Gründen, in dieser Reihenfolge:

1. **Der Wirkungsradius.** Die Hülle hält eine vollwertige Sitzung. Bei cue
   heißt das: `POST /api/sessions/{id}/send` tippt Text in eine laufende
   Claude-Code-Sitzung auf dem Mac, und Runs führen dort Code aus. Ein
   verlorenes Telefon wäre ein Terminal-Zugang.
2. **Ein neuer Anmeldeweg.** Google verweigert OAuth in WebViews. Nötig wären
   Custom Tab, Einmal-Token, ein `cue://`-Schema (das Android **nicht**
   exklusiv vergibt) und `POST /api/auth/native`.
3. **Eine CSP-Lockerung.** cue liefert `script-src 'self'`; Capacitors
   Legacy-Bridge spritzt ihr Skript inline ein. Die Abhilfe wäre ein
   gelockertes `script-src` für Anfragen mit der App-Kennung im User-Agent —
   für App-Nutzer fiele damit eine Verteidigungsschicht gegen XSS weg.

Preis der Entscheidung, offen benannt: **eine zweite Codebasis**, die gepflegt
werden muss, und ein Funktionsumfang, der nur wächst, wenn jemand ihn baut.

## 3 · Sicherheit: die eine neue Tür

### 3.1 Eigener Router statt erweiterter Sitzung

Der Geräte-Token erweitert **nicht** `deps.current_user_id`. Ein Bearer, der
überall gilt, öffnet stillschweigend jede bestehende Route — und genau das kann
`test_tenancy.py` beim Durchfegen aller Routen nicht auffangen, weil dort jede
Route weiterhin sauber nach `user_id` filtert.

Stattdessen ein **eigener Router unter `/api/app/`** mit eigener Abhängigkeit
`device_user_id`. Was die App erreichen darf, steht als Liste an einer Stelle
und ist in jedem Diff sichtbar. Eine neu hinzugefügte Route wird nicht
versehentlich app-erreichbar.

| Route | Zweck |
|---|---|
| `GET /api/app/prompts` | Liste (dieselbe Form wie `PromptRead`) |
| `POST /api/app/prompts` | anlegen |
| `PATCH /api/app/prompts/{id}` | ändern |
| `GET /api/app/projects` | nur lesen |
| `GET /api/app/tags` | nur lesen |
| `GET /api/app/changes` | Cursor für den Abgleich |

Die Handler sind dünn und rufen denselben Code wie die Cookie-Routen; die
Regeln (Titel-Ableitung, `TagService.set_for_prompt`, Bug-Tag nach oben,
`display_key`-Ordnung) dürfen **nicht** ein zweites Mal formuliert werden.

⚠️ `PATCH /api/app/prompts/{id}` nimmt eine **Teilmenge** von `PromptUpdate`
an: `title`, `body`, `project_id`, `unassign_project`, `status`, `tags`,
`bookmarked`, `priority`. Nicht durchgereicht werden `tested`, `blocked`,
`test_closely`, `attachment_ids`, `ai_model_id`, `optimized_manually` und
`clear_optimized_manually` — teils weil die App sie nicht anzeigt, teils weil
sie an Regeln hängen, die ohne die volle Oberfläche nicht bedienbar sind.

### 3.2 Geräte-Token

Neue Tabelle `device`:

| Feld | Anmerkung |
|---|---|
| `id` | |
| `user_id` | FK, wie jede besessene Zeile |
| `name` | frei wählbar („Pixel 8") — damit Sperren eine Bedeutung hat |
| `token_hash` | **SHA-256 des Tokens**, indiziert |
| `created_at`, `last_seen_at` | |
| `revoked_at` | gesetzt = tot |

Verwaltung über `POST/GET/DELETE /api/devices` mit **Cookie-Auth** aus den
Einstellungen der Web-App. Der Token wird mit `secrets.token_hex(32)` erzeugt
(wie `capture_token` und `snippet_sync_token`) und **genau einmal** ausgeliefert.

⚠️ Gespeichert wird der **Hash**, nicht der Token. Das weicht bewusst von
`capture_token`/`snippet_sync_token` ab, die im Klartext in der Datenbank
stehen: die nächtliche Sicherung trägt diese Datenbank vom Server herunter, und
für eine neue Tabelle gibt es keinen Grund, das fortzuschreiben. Die bestehenden
zwei Felder bleiben unangetastet — sie umzustellen ist eine eigene Aufgabe mit
eigenem Migrationsrisiko und gehört nicht in diesen Entwurf.

Sperren wirkt **sofort**: `device_user_id` prüft `revoked_at` bei jeder Anfrage,
genau wie `current_user_id` heute die Freigabe prüft.

### 3.3 Was der Token nicht kann

Runs, CLI-Senden, Optimierung, Analyse, Statistik, Snippets, Import/Export,
Anhänge, Nutzerverwaltung. Nicht durch eine Prüfung, sondern weil es diese
Routen unter `/api/app/` nicht gibt.

## 4 · Die App

Hausvorlage ist `flipper-the-ripper`: **Compose + Material 3 Expressive, Hilt,
Room 2.6.1, OkHttp 4.12, kotlinx.serialization**, Versionskatalog,
`src/main/kotlin`, `compileSdk`/`targetSdk` 35, `minSdk` 24. Kein Retrofit — das
Haus nutzt OkHttp direkt.

Paket `io.celox.cue`, Anzeigename **cue**.

**Room ist die Quelle, aus der die Oberfläche liest.** Nicht „online mit
Zwischenspeicher": jede Ansicht beobachtet die lokale Datenbank, der Abgleich
schreibt hinein. Damit ist Offline kein Sonderfall, sondern der Normalfall ohne
Netz.

Bildschirme:

- **Liste** — Prompts, nach Status gruppiert, mit Suche über Titel, Text, Tags
  und Projektname (dieselbe Auslegung wie `lib/search-query.ts`: führendes
  `"` sucht nur in Projektnamen).
- **Detail** — lesen, **kopieren** (der häufigste Griff), bearbeiten.
- **Anlegen** — Titel, Text, Projekt, Tags.
- **Einstellungen** — Token einfügen, Server-URL, Abgleich-Stand, Abmelden.

Der Token wird per **Einfügen** übernommen (die Web-Einstellungen zeigen ihn
einmal mit Kopier-Knopf). Abgelegt in `EncryptedSharedPreferences` bzw. DataStore
mit Keystore-Schlüssel — nicht in einer Klartext-Datei.

## 5 · Abgleich

**Ziehen** über den bestehenden Cursor `GET /api/app/changes?since=…`. Der
Cursor ist ein Fingerabdruck über die Daten, kein Zähler — er kann nicht
vergessen werden, wenn jemand einen Schreibpfad ergänzt. Meldet er `prompts`,
`projects` oder `tags`, wird der betroffene Teil neu geholt.

**Schieben**: lokale Änderungen landen in einer Warteschlange und gehen raus,
sobald Netz da ist.

### Die Regel bei Konflikten

> Eine lokale Änderung gewinnt beim Hochschieben. Beim Ziehen werden nur Zeilen
> überschrieben, die **keine** offene lokale Änderung tragen.

Der Verlustfall ist damit benannt statt versteckt: wer denselben Prompt am
Rechner ändert, während das Telefon offline eine Änderung hält, verliert die
Rechner-Fassung. Bei einem Ein-Personen-Werkzeug ist das selten; die Alternative
(`If-Match` + 409 + Konfliktdialog) wäre mehr Backend-Fläche und eine Oberfläche
für einen Fall, der kaum eintritt. Wird der Fall real, ist die Erweiterung
additiv.

## 6 · Fehlerfälle

⚠️ **„Kein Netz" und „Token gesperrt" dürfen nie verwechselt werden.**

| Lage | Verhalten |
|---|---|
| Zeitablauf, DNS, 5xx | lokale Kopie bleibt, Warteschlange bleibt, stiller Wiederversuch |
| **401 / 403** | lokale Kopie **wird gelöscht**, Token verworfen, Hinweis „Gerät gesperrt" |
| 409/422 beim Schieben | Eintrag bleibt in der Warteschlange, Fehler wird angezeigt — nie stillschweigend verwerfen |

Das Löschen bei 401 ist der Gegenwert dafür, dass überhaupt lokal gespeichert
wird: ein gesperrtes Gerät hält danach keine Prompts mehr. Ein Zeitablauf darf
das auf keinen Fall auslösen.

## 7 · Tests

**Backend**

- *Eigenschaftstest:* die Routen unter `/api/app/` sind **genau** die Liste aus
  § 3.1. Eine neue Route fällt auf, statt still erreichbar zu werden.
- Ein Geräte-Token scheitert an Runs, CLI-Senden, Optimierung (404/401, nicht
  403 — „verboten" bestätigt die Existenz).
- Der Token steht nicht im Klartext in der Datenbank.
- Sperren wirkt bei der nächsten Anfrage.
- Mandantentrennung: ein fremdes Gerät sieht 404, nie 403.
- `test_docs.py` fordert die neuen Routen in `docs/API.md`.

**Android**

- Die Abgleich-Regeln als **reine Kotlin-Funktionen** (Warteschlange,
  Konfliktregel, 401-vs-Netzfehler) — dieselbe Haltung wie im Web-Teil: Logik
  aus der Oberfläche heben, damit sie ohne Gerät prüfbar ist.
- Room-DAO-Tests.
- Jede neue Zusicherung wird **mutationsgeprüft** — ein Test, den man nicht hat
  scheitern sehen, ist keine Zusicherung.

## 8 · Signieren, Bauen, Ausliefern

Nach dem Runbook in `My Drive/dev/keystore/CLAUDE.md`:

- `cue-keystore/` mit `release.jks`, `keystore.properties`, `secrets.txt`
- `io.celox.cue`, Alias `cue`, RSA 2048, SHA256withRSA, 10000 Tage
- DName `CN=Martin Pfeffer, O=celox.io, L=Munich, C=DE`
- Werte zusätzlich in die GitHub-Secrets von `pepperonas/cue`

⚠️ **cue ist ein öffentliches Repo.** `release.jks` und `keystore.properties`
sind gitignored; vor jedem `git add` wird geprüft, dass nichts davon vorgemerkt
ist. `backend/tests/test_no_secrets_in_repo.py` deckt das bereits ab und wird um
die Keystore-Muster erweitert.

Die **APK geht als Anhang an ein GitHub-Release** (`android-v<ver>`), nicht in
den Baum — eine Binärdatei bleibt sonst für immer in der Historie eines
öffentlichen Repos. Vor der Veröffentlichung prüft `apksigner verify` die
Signatur; unsigniert fiele es sonst erst auf dem Telefon auf.

Werkbank-Befunde vom 2026-09-24, die das Release-Werkzeug selbst setzen muss:

- JDK 21 liegt unter `~/Library/Java/JavaVirtualMachines/openjdk-21.0.2`,
  ist aber **nicht** Standard (`java -version` meldet 17).
- `ANDROID_HOME` ist ungesetzt; das SDK liegt unter `~/Library/Android/sdk`.
- `apksigner` steckt in `build-tools/35.0.0`, nicht im PATH.
- **17 GB frei** — das Runbook warnt namentlich vor `ENOSPC` bei Gradle.

## 9 · Was nicht gebaut wird

Runs, CLI-Senden, Optimierung, Analyse, Statistik, Snippets, Anhänge, Import,
Export, Admin.

**FCM liegt still.** Die Meldung „Lauf fertig" war sinnvoll, solange die App die
Läufe treibt; das tut sie nicht mehr, und für Läufe gibt es die bestehende
Fernsteuerung. FCM brächte genau die Fläche zurück, wegen der umgeplant wurde
(Dienstkonto auf dem VPS, Geräte-Tabelle für Push, Firebase-Projekt). Kommt als
eigene Stufe, wenn die Meldung fehlt.

## 10 · Offene Punkte

- Ein echtes Gerät zum Prüfen; der Emulator genügt für Netzverhalten, nicht für
  den Umgang mit Hintergrund und Speicherdruck.
- Das Symbol der App ist noch nicht gezeichnet (`frontend/public/favicon.svg`
  ist die Quelle des Hauszeichens und der naheliegende Ausgangspunkt).
