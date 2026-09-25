# cue für Android

Eine kleine native App, mit der Prompts **unterwegs gelesen, gesucht, kopiert,
angelegt und bearbeitet** werden — offline benutzbar, Room ist die Quelle, aus
der die Oberfläche liest, der Abgleich schreibt nur hinein. Kein Cookie, kein
Browser, kein WebView: die App spricht ausschließlich die eigene, schmale
Fläche `/api/app/*` des cue-Backends (Entwurf: [`docs/superpowers/specs/2026-09-24-android-app-design.md`](../docs/superpowers/specs/2026-09-24-android-app-design.md)).

## Was die App kann

- **Liste** — alle Prompts, nach Status gruppiert, Suche über Titel, Text,
  Tags und Projektname (führendes `"` sucht nur in Projektnamen — dieselbe
  Auslegung wie `frontend/src/lib/search-query.ts`).
- **Detail** — lesen, mit einem Tipp **kopieren**, bearbeiten.
- **Anlegen / Bearbeiten** — Titel, Text, Projekt, Tags, Status, Priorität.
- **Einstellungen** — Server-Adresse + Geräte-Token einfügen, Abgleich-Stand
  sehen, „Jetzt abgleichen", Abmelden.
- **Offline-Warteschlange** — eine Änderung, während kein Netz da ist, bleibt
  lokal sichtbar und geht raus, sobald wieder Netz da ist (Hintergrund-Abgleich
  alle 15 Minuten über WorkManager, plus sofort nach jeder Änderung, plus ein
  laufender Long-Poll, solange die Liste sichtbar ist).

## Was die App bewusst NICHT kann

Keine Läufe (Run-Engine), kein Tippen in eine laufende CLI-Sitzung, keine
KI-Optimierung, keine Analyse, keine Statistik, keine Snippets, keine
Anhänge/Screenshots, kein Import/Export, keine Nutzerverwaltung. Das ist keine
Sparfassung — der Geräte-Token öffnet serverseitig nur sechs Routen unter
`/api/app/` (siehe Entwurf § 3.1); alles andere gibt es für ein Telefon nicht,
weil die Route dort nicht existiert.

## Einrichtung

1. Auf der Web-App unter **Einstellungen → Geräte** ein neues Gerät anlegen
   (frei wählbarer Name, z. B. „Pixel 8") und den angezeigten Token **sofort
   kopieren** — er wird nur genau einmal angezeigt.
2. In der Android-App unter **Einstellungen** die Server-Adresse eintragen
   (Standard `https://cue.celox.io`) und den Token einfügen. Ein
   erfolgreicher Verbindungsversuch schaltet die Liste frei.
3. Ein gesperrtes Gerät (in den Web-Einstellungen widerrufen) merkt die App
   bei der nächsten Anfrage: die lokale Kopie wird gelöscht, der Token
   verworfen, und es erscheint der Hinweis „Gerät gesperrt" — von dort aus
   lässt sich sofort ein neuer Token einfügen.

## Bauen

Voraussetzungen: **JDK 21** und das Android SDK.

```bash
export JAVA_HOME=~/Library/Java/JavaVirtualMachines/openjdk-21.0.2/Contents/Home
export ANDROID_HOME=~/Library/Android/sdk

cd android
./gradlew assembleDebug          # unsigniertes Debug-APK
```

`compileSdk`/`targetSdk` sind 35, `minSdk` 24 (Android 7.0) — `apksigner`
liegt entsprechend unter `$ANDROID_HOME/build-tools/35.0.0/`.

## Tests

```bash
cd android
./gradlew testDebugUnitTest
```

Die Abgleich-Regeln (Warteschlange, Konfliktregel, 401-vs-Netzfehler,
Spaltenreihenfolge, Server-URL-Normalisierung, Suche) sind reine Kotlin-
Funktionen ohne Gerät — sie liegen unter `core/` und laufen als reine JVM-
Unit-Tests. Die Spaltenreihenfolge ist zusätzlich gegen den gemeinsamen
Vertrag [`contracts/column-order.json`](../contracts/column-order.json)
gepinnt (`ColumnOrderContractTest`), denselben, den auch das Backend und das
Web-Frontend lesen — ein Web-Zusatz, der die Reihenfolge ändert, ohne den
Vertrag anzupassen, fällt hier automatisch auf.

## Release

Ein signiertes Release entsteht ausschließlich über CI: ein Tag `android-v*`
löst `.github/workflows/android-release.yml` aus, das App-Bundle wird gebaut,
mit `apksigner verify` geprüft und als Anhang an ein GitHub-Release gehängt
— **nicht** in den Baum. `cue` ist ein öffentliches Repo: Keystore und
Passwörter leben ausschließlich in GitHub-Secrets (`KEYSTORE_BASE64`,
`KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`), niemals im Code.

Lokal (mit einer `keystore.properties`, die niemals committet wird):

```bash
cd android
./gradlew :app:assembleRelease
"$ANDROID_HOME/build-tools/35.0.0/apksigner" verify --print-certs \
  app/build/outputs/apk/release/app-release.apk
```

## Fehlerfälle

⚠️ **„Kein Netz" und „Token gesperrt" dürfen nie verwechselt werden** — ein
Zeitablauf darf die lokale Kopie niemals löschen, nur eine echte Sperre darf
das.

| Lage | Verhalten |
| --- | --- |
| Zeitablauf, DNS, 5xx | lokale Kopie bleibt, Warteschlange bleibt, stiller Wiederversuch |
| **401 / 403** | lokale Kopie **wird gelöscht**, Token verworfen, Hinweis „Gerät gesperrt" |
| 409/422 beim Schieben | Eintrag bleibt in der Warteschlange, Fehler wird angezeigt — nie stillschweigend verworfen |

Das Löschen bei 401/403 ist der Gegenwert dafür, dass überhaupt lokal
gespeichert wird: ein gesperrtes Gerät hält danach keine Prompts mehr.

## Konfliktregel beim Abgleich

Eine lokale Änderung gewinnt beim Hochschieben. Beim Herunterziehen werden
nur Zeilen überschrieben, die **keine** offene lokale Änderung tragen. Wer
denselben Prompt am Rechner ändert, während das Telefon offline eine Änderung
hält, verliert damit die Rechner-Fassung — bewusst in Kauf genommen für ein
Ein-Personen-Werkzeug (Details: Entwurf § 5).

## Projektstruktur

```
app/src/main/kotlin/io/celox/cue/
  core/       reine Kotlin-Regeln ohne Android-Abhängigkeit (Model, ColumnOrder,
              SearchQuery, ServerUrl, SyncRules) — hier liegt die getestete Logik
  data/       Room (db/), Auth (auth/), Netz (net/, spricht nur /api/app/*),
              Abgleich (sync/: SyncEngine + SyncWorker)
  di/         Hilt-Module
  ui/         Compose-Screens (list/, detail/, edit/, settings/) + Theme
app/src/test/kotlin/  JVM-Unit-Tests, Robolectric für Room/WorkManager
```

## Lizenz

[MIT](../LICENSE) © 2026 Martin Pfeffer ([celox.io](https://celox.io))

---

© 2026 Martin Pfeffer | celox.io
