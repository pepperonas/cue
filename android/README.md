# cue für Android

Eine kleine native App, mit der Prompts **unterwegs gelesen, gesucht, kopiert,
angelegt und bearbeitet** werden — offline benutzbar, Room ist die Quelle, aus
der die Oberfläche liest, der Abgleich schreibt nur hinein. Kein Cookie, kein
Browser, kein WebView: die App spricht ausschließlich die eigene, schmale
Fläche `/api/app/*` des cue-Backends (Entwurf: [`docs/superpowers/specs/2026-09-24-android-app-design.md`](../docs/superpowers/specs/2026-09-24-android-app-design.md)).

## Installieren

1. Die APK vom neuesten Release laden:
   [`android-v*`-Releases](https://github.com/pepperonas/cue/releases?q=android-v&expanded=true)
   (`cue-<version>.apk`) und installieren — Android fragt einmalig nach der
   Erlaubnis, Apps aus dieser Quelle zu installieren.
2. In der cue-Web-App **Einstellungen → Geräte → Gerät anlegen**. Der Token
   wird **genau einmal** angezeigt (gespeichert wird nur sein Hash).
3. In der App unter Einstellungen Server-Adresse (`https://cue.celox.io`) und
   Token einfügen („Einfügen" nimmt die Zwischenablage; Leerzeichen und
   Zeilenumbrüche aus dem Kopieren werden entfernt), „Verbinden".

Ein Gerät lässt sich in der Web-App jederzeit sperren — die App löscht dann
beim nächsten Abgleich ihre lokale Kopie und meldet „Gerät gesperrt".

**Echtheit prüfen** (optional): jede Release-APK ist mit demselben Schlüssel
signiert.

```bash
apksigner verify --print-certs cue-0.1.0.apk
# Signer #1 certificate DN: CN=Martin Pfeffer, O=celox.io, L=Munich, C=DE
# Signer #1 certificate SHA-256 digest:
#   8b94fc80686e1090e87c4f5904cd3432bdbe60649198a073a096bbf345e38121
```

Die Debug-Variante (`io.celox.cue.debug`) ist ein eigenes Paket und steht
neben der Release-App; ein Update über sie hinweg geht nicht.

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

`compileSdk`/`targetSdk` sind 35, `minSdk` 24 (Android 7.0). `buildToolsVersion`
ist in `app/build.gradle.kts` fest auf `35.0.0` gesetzt — nicht aus `compileSdk`
abgeleitet —, damit `apksigner` garantiert unter
`$ANDROID_HOME/build-tools/35.0.0/` liegt (die Release-Pipeline ruft ihn beim
Namen auf).

## Tests

```bash
cd android
./gradlew testDebugUnitTest
```

Die Abgleich-Regeln (Warteschlange, Konfliktregel, 401-vs-Netzfehler,
Spaltenreihenfolge, Server-URL-Normalisierung, Suche) sind reine Kotlin-
Funktionen ohne Gerät — sie liegen unter `core/` und laufen als reine JVM-
Unit-Tests. Status-/Prioritätswerte und die Form des Geräte-Tokens sind gegen
[`contracts/app-api.json`](../contracts/app-api.json) gepinnt
(`AppApiContractTest`, Backend: `test_app_api_contract.py`). Die Spaltenreihenfolge ist zusätzlich gegen den gemeinsamen
Vertrag [`contracts/column-order.json`](../contracts/column-order.json)
gepinnt (`ColumnOrderContractTest`), denselben, den auch das Backend und das
Web-Frontend lesen — ein Web-Zusatz, der die Reihenfolge ändert, ohne den
Vertrag anzupassen, fällt hier automatisch auf.

## Release

Ein signiertes Release entsteht ausschließlich über CI: ein Tag `android-v*`
löst `.github/workflows/android-release.yml` aus, das APK wird gebaut,
mit `apksigner verify` geprüft und als Anhang an ein GitHub-Release gehängt
— **nicht** in den Baum. `cue` ist ein öffentliches Repo: Keystore und
Passwörter leben ausschließlich in GitHub-Secrets (`KEYSTORE_BASE64`,
`KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`), niemals im Code. Der Lauf
bricht ab, wenn die Version im Tag (`android-v0.2.0`) nicht dem `versionName`
in `app/build.gradle.kts` entspricht.

Nächstes Release:

1. In `app/build.gradle.kts` `versionCode` um 1 erhöhen und `versionName`
   setzen, Eintrag im `CHANGELOG.md` der Wurzel.
2. Vorher den R8-Build auf dem Emulator gegen ein lokales Backend
   durchspielen — Debug-Build und Unit-Tests sehen R8 nicht. Dafür eine
   **wegwerfbare** Kopie der Debug-Netzwerkkonfiguration nach `src/release/`
   legen (das Release erlaubt kein `http://`), bauen, testen, **löschen**.
3. Committen, pushen, `git tag -a android-vX.Y.Z -m "…" && git push origin android-vX.Y.Z`,
   dann `gh run watch` und die heruntergeladene APK mit `apksigner` prüfen.

Der Schlüssel liegt gesichert im privaten Repo `pepperonas/keystore`
(`cue-keystore/`); ohne ihn lässt sich kein Update über eine bestehende
Installation einspielen.

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
| Zeitablauf, DNS (kein Netz) | lokale Kopie bleibt, Warteschlange bleibt, stiller Wiederversuch |
| 408/429/5xx auf einer Änderung | diese Änderung bleibt stehen, die übrigen gehen raus, gezogen wird trotzdem; Wiederversuch mit Zurückweichen |
| **401 / 403** | lokale Kopie **wird gelöscht**, Token verworfen, Hinweis „Gerät gesperrt" |
| 400 beim Schieben (z. B. `Unknown project`, `Prompt is blocked`) oder 422 (Schema) | Eintrag bleibt in der Warteschlange, Fehler wird angezeigt — nie stillschweigend verworfen |
| 404 beim Schieben (am Rechner gelöscht) | die lokale Änderung gewinnt: aus der vollen lokalen Zeile neu angelegt |
| 2xx, aber unlesbare Antwort | nicht wiederholt (der Server hat geschrieben) — die Änderung wird verworfen und ein vollständiger Zug übernimmt den Serverstand |

Das Löschen bei 401/403 ist der Gegenwert dafür, dass überhaupt lokal
gespeichert wird: ein gesperrtes Gerät hält danach keine Prompts mehr.

## Konfliktregel beim Abgleich

Eine lokale Änderung gewinnt beim Hochschieben. Beim Herunterziehen werden
nur Zeilen überschrieben, die **keine** offene lokale Änderung tragen. Das
PATCH trägt nur die am Telefon geänderten Felder: wird derselbe Prompt am
Rechner geändert, während das Telefon offline eine Änderung hält, verlieren
nur die **auf beiden Seiten** geänderten Felder die Rechner-Fassung — alles,
was nur am Rechner geändert wurde, bleibt erhalten (die Server-Antwort wird
danach übernommen). Bewusst in Kauf genommen für ein Ein-Personen-Werkzeug
(Details: Entwurf § 5).

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
