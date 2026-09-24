# cue für Android — Umsetzungsplan (Teil B: die App)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine native Android-App, mit der Prompts unterwegs gelesen, gesucht, kopiert, angelegt und bearbeitet werden — offline benutzbar, ausschließlich über den Geräte-Token und `/api/app/`.

**Architecture:** Room ist die Quelle, aus der jede Ansicht liest; ein `SyncEngine` schiebt eine Warteschlange lokaler Änderungen hoch und zieht über den `changes`-Cursor nach. Alle Regeln, die ohne Gerät prüfbar sein müssen (Suche, Spaltenreihenfolge, Konfliktregel, 401-gegen-Netzfehler, Zusammenfassen der Warteschlange), sind reine Kotlin-Funktionen in `core/`. Die Oberfläche ist Compose + Material 3 Expressive nach dem Vorbild `flipper-the-ripper`.

**Tech Stack:** Kotlin 2.0.21, AGP 8.7.3, Compose (Versionen aus flipper-the-ripper), Material 3 1.5.0-alpha18, Hilt 2.52, Room 2.6.1, WorkManager 2.10.0, OkHttp 4.12.0 (+ MockWebServer), kotlinx.serialization 1.7.3, androidx.security-crypto 1.1.0-alpha06; Tests: JUnit 4, Truth, Robolectric 4.14.1, kotlinx-coroutines-test.

**Spec:** `docs/superpowers/specs/2026-09-24-android-app-design.md` (§ 4–8). **Voraussetzung:** Teil A (`docs/superpowers/plans/2026-09-24-android-a-backend.md`) ist ausgeliefert — `/api/app/*` und `/api/devices` laufen auf cue.celox.io.

## Global Constraints

- Paket `io.celox.cue`, Anzeigename **cue**, `compileSdk`/`targetSdk` 35, `minSdk` 24, Java/JVM 17, Quellen unter `src/main/kotlin`.
- Kein Retrofit — OkHttp direkt.
- Das Projekt liegt in **`android/`** im cue-Repo. cue ist **öffentlich**: `*.jks`, `*.keystore`, `keystore.properties`, `local.properties`, `secrets.txt` sind gitignored, und vor jedem `git add` wird geprüft, dass nichts davon vorgemerkt ist.
- Die App spricht **nur** `/api/app/*`. Kein Cookie, kein anderer Pfad.
- **401 und 403** ⇒ lokale Kopie löschen, Token verwerfen, Hinweis „Gerät gesperrt". **Zeitablauf, DNS, 5xx** ⇒ nichts löschen, still wiederholen. Beides darf nie verwechselt werden.
- **409/422 beim Schieben** ⇒ Eintrag bleibt in der Warteschlange, Fehler wird angezeigt, nie stillschweigend verwerfen.
- Konfliktregel: lokale Änderung gewinnt beim Schieben; beim Ziehen werden nur Zeilen **ohne** offene lokale Änderung überschrieben.
- Token + Server-URL liegen in `EncryptedSharedPreferences`, nie in einer Klartext-Datei.
- `PATCH` schickt **nur geänderte Felder** und nur aus der erlaubten Teilmenge (`title`, `body`, `project_id`, `unassign_project`, `status`, `tags`, `bookmarked`, `priority`) — der Server antwortet sonst 422.
- APK geht als Anhang an ein GitHub-Release `android-v<ver>`, nie in den Baum. `apksigner verify` vor der Veröffentlichung.
- Jede neue Zusicherung wird mutationsgeprüft. **Vor dem Mutieren committen.**
- Werkbank: `export JAVA_HOME=~/Library/Java/JavaVirtualMachines/openjdk-21.0.2/Contents/Home`, `export ANDROID_HOME=~/Library/Android/sdk`; `apksigner` liegt in `$ANDROID_HOME/build-tools/35.0.0/`. Vor jedem Gradle-Lauf `df -h /` — unter 10 GB frei erst aufräumen (Runbook: ENOSPC).

## Review Focus

1. **Ein offline angelegter Prompt wird offline gleich wieder bearbeitet** — erwartet: ein einziger POST mit dem Endstand, kein PATCH auf eine negative ID. → Test in Task 3 (`coalesce`) und Task 6 (Engine).
2. **Der Server löscht einen Prompt, den das Telefon noch hält** (am Rechner gelöscht) — erwartet: verschwindet lokal beim nächsten Ziehen, außer er trägt eine offene Änderung. → Test in Task 3 (`planMerge`).
3. **Sperren, während Änderungen in der Warteschlange stehen** — erwartet: auch die Warteschlange wird gelöscht; nichts wird nach einem neuen Token an ein anderes Konto geschoben. → Test in Task 6.
4. **Ein Eintrag, den der Server mit 422 ablehnt, steht vor weiteren** — erwartet: die übrigen Prompts werden trotzdem geschoben, nur die Einträge desselben Prompts warten. → Test in Task 6.
5. **Server-URL mit abschließendem Schrägstrich oder ohne `https://`** — erwartet: wird normalisiert bzw. mit klarer Meldung abgelehnt, nicht `https://cue.celox.io//api/app/…` oder ein Absturz. → Test in Task 5.

---

## Dateistruktur

```
android/
  settings.gradle.kts, build.gradle.kts, gradle.properties, gradle/libs.versions.toml, gradlew(+.bat), gradle/wrapper/*
  .gitignore
  app/build.gradle.kts, app/proguard-rules.pro
  app/src/main/AndroidManifest.xml
  app/src/main/kotlin/io/celox/cue/
    CueApplication.kt                 Hilt-Einstieg, WorkManager-Konfiguration
    core/SearchQuery.kt               Suche (Port von frontend/src/lib/search-query.ts)
    core/ColumnOrder.kt               Spaltenreihenfolge (Port von lib/order.ts:columnComparator)
    core/SyncRules.kt                 classify, planMerge, coalesce, PatchFields
    core/ServerUrl.kt                 URL normalisieren
    data/db/Entities.kt, Daos.kt, CueDatabase.kt
    data/net/Dtos.kt, CueApi.kt, ApiResult.kt
    data/auth/TokenStore.kt           Interface + EncryptedSharedPreferences-Umsetzung
    data/sync/SyncEngine.kt           schieben, ziehen, sperren
    data/sync/SyncWorker.kt           WorkManager
    data/PromptRepository.kt          was die Oberfläche benutzt
    di/AppModule.kt
    ui/MainActivity.kt, ui/CueApp.kt (Navigation), ui/theme/Theme.kt
    ui/list/ListScreen.kt, ListViewModel.kt
    ui/detail/DetailScreen.kt
    ui/edit/EditScreen.kt, EditViewModel.kt
    ui/settings/SettingsScreen.kt, SettingsViewModel.kt
  app/src/test/kotlin/io/celox/cue/…  JVM- und Robolectric-Tests
.github/workflows/android-release.yml
```

---

### Task 1: Gerüst, das baut

**Files:**
- Create: alles unter `android/` außer `app/src/main/kotlin/io/celox/cue/{core,data,di,ui}` (kommt später)
- Create: `android/app/src/test/kotlin/io/celox/cue/SmokeTest.kt`
- Modify: `backend/tests/test_no_secrets_in_repo.py`
- Modify: `.gitignore` (Repo-Wurzel)

**Interfaces:**
- Produces: ein Gradle-Projekt, in dem `./gradlew :app:testDebugUnitTest :app:assembleDebug` grün läuft; `CueApplication` (`@HiltAndroidApp`), leere `MainActivity`.

- [ ] **Step 1: Wächter gegen Schlüssel im Repo zuerst**

In `backend/tests/test_no_secrets_in_repo.py` einen Test anhängen (die Datei holt die Dateiliste bereits über `git ls-files`; die dortige Hilfsfunktion wiederverwenden — Namen mit `grep -n "def \|ls-files" backend/tests/test_no_secrets_in_repo.py` nachsehen):

```python
FORBIDDEN_FILES = re.compile(r"(^|/)(.+\.jks|.+\.keystore|keystore\.properties|secrets\.txt|local\.properties)$")


def test_no_signing_material_is_tracked():
    """cue ist öffentlich. Ein einmal gepushter Keystore bleibt für immer in der
    Historie — der Schlüssel wäre verbrannt, jedes spätere Update müsste mit
    einem neuen signiert werden und ließe sich nicht mehr über die alte App
    installieren."""
    tracked = subprocess.run(
        ["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout.splitlines()
    hits = [f for f in tracked if FORBIDDEN_FILES.search(f)]
    assert not hits, f"Signier-Material im Repo: {hits}"


def test_the_signing_guard_can_see_a_keystore(tmp_path):
    """Gegenprobe: ein Wächter, der 0 meldet, ist erst glaubwürdig, wenn er
    etwas finden kann."""
    for name in ["android/release.jks", "android/keystore.properties", "x/upload.keystore"]:
        assert FORBIDDEN_FILES.search(name), name
    for name in ["android/app/build.gradle.kts", "docs/keystore.md"]:
        assert not FORBIDDEN_FILES.search(name), name
```

(`re`, `subprocess`, `ROOT` sind in der Datei vorhanden oder oben zu importieren — prüfen.)

Run: `cd backend && uv run pytest tests/test_no_secrets_in_repo.py -v` → PASS (noch nichts getrackt).

Wurzel-`.gitignore` ergänzen:

```
# Android
android/.gradle/
android/build/
android/app/build/
android/local.properties
*.jks
*.keystore
keystore.properties
secrets.txt
android/.idea/
*.apk
*.aab
```

- [ ] **Step 2: Gradle-Dateien**

Wrapper aus flipper übernehmen (gleiche Gradle-Version, kein neuer Download):

```bash
mkdir -p android/gradle/wrapper
cp ~/claude/flipper-the-ripper/gradlew ~/claude/flipper-the-ripper/gradlew.bat android/
cp ~/claude/flipper-the-ripper/gradle/wrapper/* android/gradle/wrapper/
cp ~/claude/flipper-the-ripper/gradle.properties android/
```

`android/settings.gradle.kts`:

```kotlin
pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "cue"
include(":app")
```

`android/build.gradle.kts`:

```kotlin
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.ksp) apply false
    alias(libs.plugins.hilt) apply false
}
```

`android/gradle/libs.versions.toml` — die Einträge aus `~/claude/flipper-the-ripper/gradle/libs.versions.toml` für `agp, kotlin, ksp, hilt, hiltNavigationCompose, coreKtx, lifecycle, activityCompose, compose, material3, iconsExtended, navigationCompose, kotlinxSerialization, kotlinxCoroutines, room, workManager, okhttp, junit, truth, robolectric, coroutinesTest, androidxTestCore` **wörtlich** übernehmen (samt der zugehörigen `[libraries]`- und `[plugins]`-Zeilen), die übrigen (yt-dlp, coil, reorderable, kover, spotless, detekt, mockk, turbine, espresso …) weglassen. Zusätzlich:

```toml
[versions]
securityCrypto = "1.1.0-alpha06"

[libraries]
androidx-security-crypto = { group = "androidx.security", name = "security-crypto", version.ref = "securityCrypto" }
okhttp-mockwebserver = { group = "com.squareup.okhttp3", name = "mockwebserver", version.ref = "okhttp" }
hilt-work = { group = "androidx.hilt", name = "hilt-work", version = "1.2.0" }
hilt-work-compiler = { group = "androidx.hilt", name = "hilt-compiler", version = "1.2.0" }
androidx-work-testing = { group = "androidx.work", name = "work-testing", version.ref = "workManager" }
```

`android/app/build.gradle.kts`:

```kotlin
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

// Signieren: keystore.properties (lokal, gitignored) oder Umgebung (CI).
val keystorePropsFile = rootProject.file("keystore.properties")
val keystoreProps = Properties().apply {
    if (keystorePropsFile.exists()) keystorePropsFile.inputStream().use { load(it) }
}
val hasSigning = keystorePropsFile.exists() || System.getenv("KEYSTORE_PASSWORD") != null

android {
    namespace = "io.celox.cue"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.celox.cue"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    signingConfigs {
        if (hasSigning) {
            create("release") {
                if (keystorePropsFile.exists()) {
                    storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                    storePassword = keystoreProps.getProperty("storePassword")
                    keyAlias = keystoreProps.getProperty("keyAlias")
                    keyPassword = keystoreProps.getProperty("keyPassword")
                } else {
                    storeFile = rootProject.file(System.getenv("KEYSTORE_FILE") ?: "release.jks")
                    storePassword = System.getenv("KEYSTORE_PASSWORD")
                    keyAlias = System.getenv("KEY_ALIAS")
                    keyPassword = System.getenv("KEY_PASSWORD")
                }
            }
        }
    }

    buildTypes {
        debug { applicationIdSuffix = ".debug" }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (hasSigning) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
        freeCompilerArgs += listOf(
            "-opt-in=androidx.compose.material3.ExperimentalMaterial3ExpressiveApi",
            "-opt-in=androidx.compose.material3.ExperimentalMaterial3Api",
        )
    }
    buildFeatures { compose = true; buildConfig = true }
    testOptions { unitTests.isIncludeAndroidResources = true }
}

ksp { arg("room.schemaLocation", "$projectDir/schemas") }

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    debugImplementation(libs.androidx.compose.ui.tooling)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)
    implementation(libs.hilt.work)
    ksp(libs.hilt.work.compiler)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)
    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.okhttp)
    implementation(libs.androidx.security.crypto)

    testImplementation(libs.junit)
    testImplementation(libs.truth)
    testImplementation(libs.robolectric)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.androidx.room.testing)
    testImplementation(libs.androidx.work.testing)
}
```

`android/app/proguard-rules.pro`:

```
# kotlinx.serialization: generierte Serializer der DTOs behalten.
-keepattributes *Annotation*, InnerClasses
-keepclassmembers class io.celox.cue.data.net.** { *** Companion; }
-keepclasseswithmembers class io.celox.cue.data.net.** { kotlinx.serialization.KSerializer serializer(...); }
```

- [ ] **Step 3: Minimale App**

`app/src/main/AndroidManifest.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <application
        android:name=".CueApplication"
        android:label="cue"
        android:allowBackup="false"
        android:supportsRtl="true"
        android:theme="@android:style/Theme.Material.NoActionBar">
        <activity
            android:name=".ui.MainActivity"
            android:exported="true"
            android:windowSoftInputMode="adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
        <!-- WorkManager wird in CueApplication konfiguriert (Hilt-Worker). -->
        <provider
            android:name="androidx.startup.InitializationProvider"
            android:authorities="${applicationId}.androidx-startup"
            android:exported="false"
            xmlns:tools="http://schemas.android.com/tools"
            tools:node="merge">
            <meta-data
                android:name="androidx.work.WorkManagerInitializer"
                android:value="androidx.startup"
                tools:node="remove" />
        </provider>
    </application>
</manifest>
```

⚠️ `allowBackup="false"`: sonst landet die lokale Prompt-Kopie in der Google-Sicherung — und überlebt damit genau das Sperren, das sie löschen soll.

`CueApplication.kt`:

```kotlin
package io.celox.cue

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class CueApplication : Application(), Configuration.Provider {
    @Inject lateinit var workerFactory: HiltWorkerFactory

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(workerFactory).build()
}
```

`ui/MainActivity.kt`:

```kotlin
package io.celox.cue.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.Text
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { Text("cue") }
    }
}
```

`app/src/test/kotlin/io/celox/cue/SmokeTest.kt`:

```kotlin
package io.celox.cue

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class SmokeTest {
    @Test fun `the toolchain runs`() { assertThat(1 + 1).isEqualTo(2) }
}
```

- [ ] **Step 4: Bauen**

```bash
export JAVA_HOME=~/Library/Java/JavaVirtualMachines/openjdk-21.0.2/Contents/Home
export ANDROID_HOME=~/Library/Android/sdk
df -h / | tail -1
cd android && ./gradlew :app:testDebugUnitTest :app:assembleDebug
```

Expected: `BUILD SUCCESSFUL`, `SmokeTest` grün.

- [ ] **Step 5: Commit**

```bash
cd /Users/martin/claude/cue
git status --short   # KEIN *.jks, keystore.properties, local.properties
git add .gitignore backend/tests/test_no_secrets_in_repo.py android/
git commit -m "feat(android): Geruest io.celox.cue, baut und testet"
```

- [ ] **Step 6: Mutationsprobe**

`touch android/probe.jks && git add -f android/probe.jks && (cd backend && uv run pytest tests/test_no_secrets_in_repo.py -q)` → rot. Dann `git rm --cached -q android/probe.jks && rm android/probe.jks`, `git status --short` leer.

---

### Task 2: Suche und Spaltenreihenfolge als reine Funktionen

**Files:**
- Create: `android/app/src/main/kotlin/io/celox/cue/core/SearchQuery.kt`
- Create: `android/app/src/main/kotlin/io/celox/cue/core/ColumnOrder.kt`
- Create: `android/app/src/main/kotlin/io/celox/cue/core/Model.kt`
- Test: `android/app/src/test/kotlin/io/celox/cue/core/SearchQueryTest.kt`, `ColumnOrderContractTest.kt`

**Interfaces:**
- Produces:
  - `enum class Status { queued, running, done, failed, archived }`, `enum class Priority { low, normal, high }` (Kleinschreibung = Wire-Format)
  - `data class PromptView(id: Long, title: String, body: String, tags: String, projectId: Long?, status: Status, sortOrder: Int, priority: Priority, blocked: Boolean, tested: Boolean, testClosely: Boolean)` — was Suche und Reihenfolge brauchen
  - `data class ParsedQuery(needle: String, projectsOnly: Boolean)`, `fun parseQuery(raw: String): ParsedQuery`, `fun promptMatches(p: PromptView, projectName: String, q: ParsedQuery): Boolean`
  - `val columnComparator: Comparator<PromptView>`

- [ ] **Step 1: Failing tests**

`SearchQueryTest.kt`:

```kotlin
package io.celox.cue.core

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class SearchQueryTest {
    private fun p(title: String = "", body: String = "", tags: String = "") = PromptView(
        id = 1, title = title, body = body, tags = tags, projectId = null,
        status = Status.queued, sortOrder = 0, priority = Priority.normal,
        blocked = false, tested = false, testClosely = false,
    )

    @Test fun `plain text searches title body tags and project name`() {
        val q = parseQuery("Suche")
        assertThat(promptMatches(p(title = "suche fixen"), "", q)).isTrue()
        assertThat(promptMatches(p(body = "die SUCHE"), "", q)).isTrue()
        assertThat(promptMatches(p(tags = "suche"), "", q)).isTrue()
        assertThat(promptMatches(p(), "suchmaschine-suche", q)).isTrue()
        assertThat(promptMatches(p(title = "anderes"), "cue", q)).isFalse()
    }

    @Test fun `a leading quote searches project names only`() {
        val q = parseQuery("\"cue")
        assertThat(q.projectsOnly).isTrue()
        assertThat(promptMatches(p(title = "cue im Titel"), "anderes", q)).isFalse()
        assertThat(promptMatches(p(), "cue", q)).isTrue()
    }

    @Test fun `the closing quote is optional and German quotes count`() {
        assertThat(parseQuery("\"cue\"")).isEqualTo(ParsedQuery("cue", true))
        assertThat(parseQuery("„cue“")).isEqualTo(ParsedQuery("cue", true))
        assertThat(parseQuery("\"cu")).isEqualTo(ParsedQuery("cu", true))
    }

    @Test fun `a lone quote or blank matches everything`() {
        assertThat(parseQuery("\"")).isEqualTo(ParsedQuery("", false))
        assertThat(promptMatches(p(), "", parseQuery("   "))).isTrue()
    }
}
```

`ColumnOrderContractTest.kt` — hält die App an **denselben** 18 Fällen fest wie Server und Web:

```kotlin
package io.celox.cue.core

import com.google.common.truth.Truth.assertThat
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Test

/**
 * `contracts/column-order.json` ist der gemeinsame Vertrag von
 * `app/ordering.py:display_key` und `lib/order.ts:columnComparator`. Die App
 * ist die vierte Stelle, die diese Ordnung formuliert — ohne diesen Test die
 * erste, die abdriften könnte, ohne dass etwas rot wird.
 */
class ColumnOrderContractTest {
    private val contract: JsonObject by lazy {
        // Gradle führt Unit-Tests im Modulverzeichnis (android/app) aus.
        val file = File("../../contracts/column-order.json")
        check(file.exists()) { "Vertrag nicht gefunden: ${file.absolutePath}" }
        Json.parseToJsonElement(file.readText()).jsonObject
    }

    private fun view(o: JsonObject) = PromptView(
        id = o["id"]!!.jsonPrimitive.long,
        title = "", body = "", tags = "", projectId = null,
        status = Status.valueOf(o["status"]!!.jsonPrimitive.content),
        sortOrder = o["sort_order"]!!.jsonPrimitive.int,
        priority = o["priority"]?.jsonPrimitive?.content?.let(Priority::valueOf) ?: Priority.normal,
        blocked = o["blocked"]?.jsonPrimitive?.boolean ?: false,
        tested = o["tested"]?.jsonPrimitive?.boolean ?: false,
        testClosely = o["test_closely"]?.jsonPrimitive?.boolean ?: false,
    )

    @Test fun `every contract case sorts as expected`() {
        val cases = contract["cases"]!!.jsonArray
        assertThat(cases.size).isAtLeast(18)
        for (case in cases) {
            val c = case.jsonObject
            val prompts = c["prompts"]!!.jsonArray.map { view(it.jsonObject) }
            val expected = c["expected_ids"]!!.jsonArray.map { it.jsonPrimitive.long }
            val actual = prompts.sortedWith(columnComparator).map { it.id }
            assertThat(actual).named(c["name"]!!.jsonPrimitive.content).isEqualTo(expected)
        }
    }
}
```

⚠️ Das Feld `ran_at` kommt in Vertragsfällen vor, darf die Reihenfolge aber nicht beeinflussen (der Vertrag zeigt genau das) — `PromptView` bekommt es deshalb bewusst nicht.

Run: `./gradlew :app:testDebugUnitTest --tests 'io.celox.cue.core.*'` → Kompilierfehler (Klassen fehlen) = rot.

- [ ] **Step 2: Implementieren**

`core/Model.kt`:

```kotlin
package io.celox.cue.core

@Suppress("EnumEntryName")
enum class Status { queued, running, done, failed, archived }

@Suppress("EnumEntryName")
enum class Priority { low, normal, high }

/** Das, was Suche und Reihenfolge von einem Prompt wissen müssen. */
data class PromptView(
    val id: Long,
    val title: String,
    val body: String,
    val tags: String,
    val projectId: Long?,
    val status: Status,
    val sortOrder: Int,
    val priority: Priority,
    val blocked: Boolean,
    val tested: Boolean,
    val testClosely: Boolean,
)
```

`core/SearchQuery.kt`:

```kotlin
package io.celox.cue.core

/**
 * Port von `frontend/src/lib/search-query.ts`. Dieselbe Auslegung wie im Web:
 * `termst` sucht im Prompt und im Projektnamen, `"termst` nur im Projektnamen;
 * das ÖFFNENDE Anführungszeichen entscheidet, das schließende ist optional.
 * Ohne Modellnamen — die App kennt den Modellkatalog nicht.
 */
data class ParsedQuery(val needle: String, val projectsOnly: Boolean)

fun parseQuery(raw: String): ParsedQuery {
    val text = raw.trim()
    val quoted = text.startsWith('"') || text.startsWith('„')
    val inner = if (quoted) text.removePrefix("\"").removePrefix("„").removeSuffix("\"").removeSuffix("“").trim() else text
    return ParsedQuery(needle = inner.lowercase(), projectsOnly = quoted && inner.isNotEmpty())
}

fun promptMatches(p: PromptView, projectName: String, q: ParsedQuery): Boolean {
    if (q.needle.isEmpty()) return true
    val name = projectName.lowercase()
    if (q.projectsOnly) return name.contains(q.needle)
    return "${p.title} ${p.body} ${p.tags}".lowercase().contains(q.needle) || name.contains(q.needle)
}
```

`core/ColumnOrder.kt`:

```kotlin
package io.celox.cue.core

/** Port von `lib/order.ts:columnComparator`; gehalten von `contracts/column-order.json`. */
private fun priorityRank(p: PromptView): Int = when {
    p.status != Status.queued -> 1
    p.priority == Priority.high -> 0
    p.priority == Priority.low -> 2
    else -> 1
}

val columnComparator: Comparator<PromptView> = Comparator { a, b ->
    val blocked = a.blocked.compareTo(b.blocked)
    if (blocked != 0) return@Comparator blocked
    if (a.status == Status.done && b.status == Status.done) {
        val tested = a.tested.compareTo(b.tested)
        if (tested != 0) return@Comparator tested
        val close = b.testClosely.compareTo(a.testClosely)
        if (close != 0) return@Comparator close
    }
    val priority = priorityRank(a) - priorityRank(b)
    if (priority != 0) return@Comparator priority
    a.sortOrder.compareTo(b.sortOrder).takeIf { it != 0 } ?: a.id.compareTo(b.id)
}
```

- [ ] **Step 3: Grün**

Run: `./gradlew :app:testDebugUnitTest --tests 'io.celox.cue.core.*'` → PASS

- [ ] **Step 4: Commit, dann Mutationsprobe**

```bash
git add android/app/src && git commit -m "feat(android): Suche und Spaltenreihenfolge, am gemeinsamen Vertrag gehalten"
```

Mutationen (je rot sehen, dann `git checkout -- android/`):
1. Im Comparator `b.testClosely.compareTo(a.testClosely)` → `a.testClosely.compareTo(b.testClosely)`.
2. `priorityRank`: die Zeile `p.status != Status.queued -> 1` entfernen.
3. `parseQuery`: `startsWith('„')` entfernen.
4. `promptMatches`: `|| name.contains(q.needle)` entfernen.

---

### Task 3: Die Abgleich-Regeln als reine Funktionen

**Files:**
- Create: `android/app/src/main/kotlin/io/celox/cue/core/SyncRules.kt`
- Test: `android/app/src/test/kotlin/io/celox/cue/core/SyncRulesTest.kt`

**Interfaces:**
- Consumes: nichts außer Kotlin + kotlinx.serialization.json
- Produces:
  - `sealed interface Outcome { object Ok; object Offline; object Revoked; data class Rejected(val code: Int, val message: String) }`
  - `fun classify(code: Int?): Outcome` — `code == null` heißt „keine Antwort" (Netzfehler)
  - `data class MergePlan(val upsert: List<Long>, val delete: List<Long>)`, `fun planMerge(serverIds: Set<Long>, localIds: Set<Long>, pendingIds: Set<Long>): MergePlan`
  - `enum class OpKind { CREATE, UPDATE }`, `data class QueuedOp(val promptId: Long, val kind: OpKind, val fields: JsonObject)`
  - `fun coalesce(existing: QueuedOp?, incoming: QueuedOp): QueuedOp`
  - `val ALLOWED_PATCH_FIELDS: Set<String>`

- [ ] **Step 1: Failing tests**

```kotlin
package io.celox.cue.core

import com.google.common.truth.Truth.assertThat
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Test

class SyncRulesTest {
    // --- classify: „kein Netz" und „gesperrt" dürfen nie verwechselt werden.

    @Test fun `no response is offline, never revoked`() {
        assertThat(classify(null)).isEqualTo(Outcome.Offline)
    }

    @Test fun `server errors are offline too`() {
        for (code in listOf(500, 502, 503, 504)) assertThat(classify(code)).isEqualTo(Outcome.Offline)
        // 408/429: der Server lebt, will aber später — wiederholen, nicht löschen.
        assertThat(classify(408)).isEqualTo(Outcome.Offline)
        assertThat(classify(429)).isEqualTo(Outcome.Offline)
    }

    @Test fun `only 401 and 403 mean revoked`() {
        assertThat(classify(401)).isEqualTo(Outcome.Revoked)
        assertThat(classify(403)).isEqualTo(Outcome.Revoked)
        assertThat(classify(404)).isInstanceOf(Outcome.Rejected::class.java)
        assertThat(classify(409)).isInstanceOf(Outcome.Rejected::class.java)
        assertThat(classify(422)).isInstanceOf(Outcome.Rejected::class.java)
    }

    @Test fun `2xx is ok`() {
        assertThat(classify(200)).isEqualTo(Outcome.Ok)
        assertThat(classify(201)).isEqualTo(Outcome.Ok)
    }

    // --- planMerge: Ziehen überschreibt nur, was keine offene Änderung trägt.

    @Test fun `server rows are applied unless a local change is pending`() {
        val plan = planMerge(serverIds = setOf(1, 2, 3), localIds = setOf(1, 2), pendingIds = setOf(2))
        assertThat(plan.upsert).containsExactly(1L, 3L)
    }

    @Test fun `rows gone on the server are deleted locally unless pending`() {
        val plan = planMerge(serverIds = setOf(1), localIds = setOf(1, 2, 3), pendingIds = setOf(3))
        assertThat(plan.delete).containsExactly(2L)
    }

    @Test fun `offline-created prompts (negative ids) are never deleted by a pull`() {
        val plan = planMerge(serverIds = emptySet(), localIds = setOf(-1, -2), pendingIds = setOf(-1, -2))
        assertThat(plan.delete).isEmpty()
    }

    // --- coalesce: die Warteschlange hält je Prompt EINEN Eintrag.

    private fun fields(vararg pairs: Pair<String, String>) =
        buildJsonObject { pairs.forEach { (k, v) -> put(k, v) } }

    @Test fun `two edits merge, the later field wins`() {
        val a = QueuedOp(5, OpKind.UPDATE, fields("title" to "a", "body" to "x"))
        val b = QueuedOp(5, OpKind.UPDATE, fields("title" to "b"))
        val merged = coalesce(a, b)
        assertThat(merged.kind).isEqualTo(OpKind.UPDATE)
        assertThat(merged.fields["title"]).isEqualTo(JsonPrimitive("b"))
        assertThat(merged.fields["body"]).isEqualTo(JsonPrimitive("x"))
    }

    @Test fun `an edit after an offline create stays a create`() {
        val create = QueuedOp(-1, OpKind.CREATE, fields("body" to "neu", "title" to ""))
        val edit = QueuedOp(-1, OpKind.UPDATE, fields("title" to "T"))
        val merged = coalesce(create, edit)
        assertThat(merged.kind).isEqualTo(OpKind.CREATE)
        assertThat(merged.fields["title"]).isEqualTo(JsonPrimitive("T"))
        assertThat(merged.fields["body"]).isEqualTo(JsonPrimitive("neu"))
    }

    @Test fun `unassign in a create becomes a missing project`() {
        // POST kennt kein unassign_project — ein Create schickt dann einfach keins.
        val create = QueuedOp(-1, OpKind.CREATE, buildJsonObject { put("body", "x"); put("project_id", 3) })
        val edit = QueuedOp(-1, OpKind.UPDATE, buildJsonObject { put("unassign_project", true) })
        val merged = coalesce(create, edit)
        assertThat(merged.fields.containsKey("project_id")).isFalse()
        assertThat(merged.fields.containsKey("unassign_project")).isFalse()
    }

    @Test fun `setting a project after unassigning clears the unassign flag`() {
        val a = QueuedOp(5, OpKind.UPDATE, buildJsonObject { put("unassign_project", true) })
        val b = QueuedOp(5, OpKind.UPDATE, buildJsonObject { put("project_id", 7) })
        val merged = coalesce(a, b)
        assertThat(merged.fields.containsKey("unassign_project")).isFalse()
        assertThat(merged.fields["project_id"]).isEqualTo(JsonPrimitive(7))
    }

    @Test fun `no field outside the allowed subset survives`() {
        val sneaky = QueuedOp(5, OpKind.UPDATE, buildJsonObject { put("title", "t"); put("tested", true) })
        assertThat(coalesce(null, sneaky).fields.keys).containsExactly("title")
    }

    @Test fun `the allowed subset matches the server`() {
        assertThat(ALLOWED_PATCH_FIELDS).containsExactly(
            "title", "body", "project_id", "unassign_project", "status", "tags", "bookmarked", "priority",
        )
    }
}
```

Run: `./gradlew :app:testDebugUnitTest --tests 'io.celox.cue.core.SyncRulesTest'` → rot (Kompilierfehler).

- [ ] **Step 2: Implementieren**

```kotlin
package io.celox.cue.core

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/**
 * Die Regeln des Abgleichs, ohne Gerät prüfbar.
 *
 * ⚠️ Die wichtigste steht in `classify`: nur 401/403 heißen „gesperrt". Ein
 * Zeitablauf, der als Sperre gelesen würde, löschte die lokale Kopie eines
 * Telefons, das nur im Tunnel steckt.
 */
sealed interface Outcome {
    data object Ok : Outcome
    data object Offline : Outcome
    data object Revoked : Outcome
    data class Rejected(val code: Int, val message: String = "") : Outcome
}

fun classify(code: Int?): Outcome = when {
    code == null -> Outcome.Offline
    code in 200..299 -> Outcome.Ok
    code == 401 || code == 403 -> Outcome.Revoked
    code == 408 || code == 429 || code >= 500 -> Outcome.Offline
    else -> Outcome.Rejected(code)
}

data class MergePlan(val upsert: List<Long>, val delete: List<Long>)

/** Ziehen überschreibt nur Zeilen OHNE offene lokale Änderung. */
fun planMerge(serverIds: Set<Long>, localIds: Set<Long>, pendingIds: Set<Long>): MergePlan =
    MergePlan(
        upsert = serverIds.filterNot { it in pendingIds }.sorted(),
        delete = localIds.filter { it !in serverIds && it !in pendingIds && it > 0 }.sorted(),
    )

enum class OpKind { CREATE, UPDATE }

data class QueuedOp(val promptId: Long, val kind: OpKind, val fields: JsonObject)

/** Muss `AppPromptUpdate` im Backend entsprechen (Teil A, Task 3). */
val ALLOWED_PATCH_FIELDS: Set<String> =
    setOf("title", "body", "project_id", "unassign_project", "status", "tags", "bookmarked", "priority")

private fun isTrue(o: JsonObject, key: String) = (o[key] as? JsonPrimitive)?.booleanOrNull == true

fun coalesce(existing: QueuedOp?, incoming: QueuedOp): QueuedOp {
    val merged = LinkedHashMap(existing?.fields ?: JsonObject(emptyMap()))
    for ((k, v) in incoming.fields) if (k in ALLOWED_PATCH_FIELDS) merged[k] = v
    // „Projekt setzen" und „Projekt entfernen" schließen sich aus; das Spätere gilt.
    if (incoming.fields.containsKey("project_id")) merged.remove("unassign_project")
    if (isTrue(incoming.fields, "unassign_project")) merged.remove("project_id")
    val kind = if (existing?.kind == OpKind.CREATE) OpKind.CREATE else incoming.kind
    if (kind == OpKind.CREATE) merged.remove("unassign_project")
    return QueuedOp(incoming.promptId, kind, JsonObject(merged))
}
```

- [ ] **Step 3: Grün, Commit, Mutationsprobe**

Run: `./gradlew :app:testDebugUnitTest --tests 'io.celox.cue.core.SyncRulesTest'` → PASS

```bash
git add android/app/src && git commit -m "feat(android): Abgleich-Regeln als reine Funktionen"
```

Mutationen: (1) `code == 401 || code == 403` → `code in 400..499`; (2) in `planMerge` `&& it > 0` entfernen; (3) `filterNot { it in pendingIds }` entfernen; (4) in `coalesce` `if (k in ALLOWED_PATCH_FIELDS)` entfernen; (5) `existing?.kind == OpKind.CREATE` → `false`. Jede muss rot werden; danach `git checkout -- android/` und `git diff --stat` leer.

---

### Task 4: Room — Datenbank und DAOs

**Files:**
- Create: `android/app/src/main/kotlin/io/celox/cue/data/db/Entities.kt`, `Daos.kt`, `CueDatabase.kt`
- Test: `android/app/src/test/kotlin/io/celox/cue/data/db/DaoTest.kt`

**Interfaces:**
- Consumes: `Status`, `Priority`, `PromptView` (Task 2)
- Produces:
  - `PromptEntity(id: Long, title, body, projectId: Long?, status: Status, sortOrder: Int, tags: String, bookmarked: Boolean, priority: Priority, blocked, tested, testClosely: Boolean, updatedAt: String)` + `fun PromptEntity.toView(): PromptView`
  - `ProjectEntity(id: Long, name: String, color: String, sortOrder: Int)`, `TagEntity(id: Long, name: String, usageCount: Int)`
  - `PendingOpEntity(promptId: Long @PrimaryKey, kind: OpKind, fieldsJson: String, lastError: String?, queuedAt: Long)` — **ein** Eintrag je Prompt (Folge von `coalesce`)
  - `SyncStateEntity(key: Int = 0 @PrimaryKey, cursor: String?, lastSyncAt: Long?, lastError: String?)`
  - `PromptDao { observeAll(): Flow<List<PromptEntity>>; observe(id): Flow<PromptEntity?>; get(id): PromptEntity?; ids(): List<Long>; upsert(List<PromptEntity>); delete(ids: List<Long>); replaceId(old: Long, new: PromptEntity) (Transaktion) }`
  - `ProjectDao { observeAll(); replaceAll(List<ProjectEntity>) }`, `TagDao { observeAll(); replaceAll(List<TagEntity>) }`
  - `PendingOpDao { all(): List<PendingOpEntity>; observeAll(): Flow<List<PendingOpEntity>>; get(promptId): PendingOpEntity?; put(PendingOpEntity); remove(promptId); setError(promptId, msg: String?); moveTo(old: Long, new: Long) }`
  - `SyncStateDao { get(): SyncStateEntity?; put(SyncStateEntity) }`
  - `CueDatabase` mit `promptDao()`, `projectDao()`, `tagDao()`, `pendingOpDao()`, `syncStateDao()`; `fun nextLocalId(): Long` (negativ, fallend)

- [ ] **Step 1: Failing test**

```kotlin
package io.celox.cue.data.db

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import io.celox.cue.core.OpKind
import io.celox.cue.core.Priority
import io.celox.cue.core.Status
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class DaoTest {
    private lateinit var db: CueDatabase

    @Before fun open() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), CueDatabase::class.java)
            .allowMainThreadQueries().build()
    }

    @After fun close() = db.close()

    private fun prompt(id: Long, title: String = "t") = PromptEntity(
        id = id, title = title, body = "b", projectId = null, status = Status.queued, sortOrder = 0,
        tags = "", bookmarked = false, priority = Priority.normal, blocked = false, tested = false,
        testClosely = false, updatedAt = "2026-09-24T10:00:00Z",
    )

    @Test fun upsertAndObserve() = runTest {
        db.promptDao().upsert(listOf(prompt(1), prompt(2)))
        db.promptDao().upsert(listOf(prompt(1, title = "neu")))
        val all = db.promptDao().observeAll().first()
        assertThat(all.map { it.id }).containsExactly(1L, 2L)
        assertThat(all.first { it.id == 1L }.title).isEqualTo("neu")
    }

    @Test fun replaceIdSwapsTheOfflineRowForTheServerRow() = runTest {
        db.promptDao().upsert(listOf(prompt(-1)))
        db.pendingOpDao().put(PendingOpEntity(-1, OpKind.CREATE, "{}", null, 0))
        db.promptDao().replaceId(-1, prompt(42))
        db.pendingOpDao().moveTo(-1, 42)
        assertThat(db.promptDao().ids()).containsExactly(42L)
        assertThat(db.pendingOpDao().get(42)).isNotNull()
        assertThat(db.pendingOpDao().get(-1)).isNull()
    }

    @Test fun localIdsAreNegativeAndNeverRepeat() {
        val a = db.nextLocalId()
        val b = db.nextLocalId()
        assertThat(a).isLessThan(0)
        assertThat(b).isLessThan(a)
    }

    @Test fun clearAllTablesLeavesNothing() = runTest {
        db.promptDao().upsert(listOf(prompt(1)))
        db.pendingOpDao().put(PendingOpEntity(1, OpKind.UPDATE, "{}", null, 0))
        db.clearAllTables()
        assertThat(db.promptDao().ids()).isEmpty()
        assertThat(db.pendingOpDao().all()).isEmpty()
    }
}
```

Run → rot (Kompilierfehler).

- [ ] **Step 2: Entities, DAOs, Datenbank**

`Entities.kt`:

```kotlin
package io.celox.cue.data.db

import androidx.room.Entity
import androidx.room.PrimaryKey
import io.celox.cue.core.OpKind
import io.celox.cue.core.Priority
import io.celox.cue.core.PromptView
import io.celox.cue.core.Status

/** Server-ID, oder NEGATIV für einen offline angelegten, noch nicht geschobenen Prompt. */
@Entity(tableName = "prompt")
data class PromptEntity(
    @PrimaryKey val id: Long,
    val title: String,
    val body: String,
    val projectId: Long?,
    val status: Status,
    val sortOrder: Int,
    val tags: String,
    val bookmarked: Boolean,
    val priority: Priority,
    val blocked: Boolean,
    val tested: Boolean,
    val testClosely: Boolean,
    val updatedAt: String,
)

fun PromptEntity.toView() = PromptView(
    id, title, body, tags, projectId, status, sortOrder, priority, blocked, tested, testClosely,
)

@Entity(tableName = "project")
data class ProjectEntity(@PrimaryKey val id: Long, val name: String, val color: String, val sortOrder: Int)

@Entity(tableName = "tag")
data class TagEntity(@PrimaryKey val id: Long, val name: String, val usageCount: Int)

/** Höchstens ein Eintrag je Prompt — `coalesce` fasst zusammen, bevor geschrieben wird. */
@Entity(tableName = "pending_op")
data class PendingOpEntity(
    @PrimaryKey val promptId: Long,
    val kind: OpKind,
    val fieldsJson: String,
    val lastError: String?,
    val queuedAt: Long,
)

@Entity(tableName = "sync_state")
data class SyncStateEntity(
    @PrimaryKey val key: Int = 0,
    val cursor: String?,
    val lastSyncAt: Long?,
    val lastError: String?,
    val nextLocalId: Long = -1,
)
```

`Daos.kt`:

```kotlin
package io.celox.cue.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface PromptDao {
    @Query("SELECT * FROM prompt") fun observeAll(): Flow<List<PromptEntity>>
    @Query("SELECT * FROM prompt WHERE id = :id") fun observe(id: Long): Flow<PromptEntity?>
    @Query("SELECT * FROM prompt WHERE id = :id") suspend fun get(id: Long): PromptEntity?
    @Query("SELECT id FROM prompt") suspend fun ids(): List<Long>
    @Upsert suspend fun upsert(rows: List<PromptEntity>)
    @Query("DELETE FROM prompt WHERE id IN (:ids)") suspend fun delete(ids: List<Long>)

    @Transaction
    suspend fun replaceId(old: Long, new: PromptEntity) {
        delete(listOf(old))
        upsert(listOf(new))
    }
}

@Dao
interface ProjectDao {
    @Query("SELECT * FROM project ORDER BY sortOrder, name") fun observeAll(): Flow<List<ProjectEntity>>
    @Query("DELETE FROM project") suspend fun clear()
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun insert(rows: List<ProjectEntity>)
    @Transaction suspend fun replaceAll(rows: List<ProjectEntity>) { clear(); insert(rows) }
}

@Dao
interface TagDao {
    @Query("SELECT * FROM tag ORDER BY usageCount DESC, name") fun observeAll(): Flow<List<TagEntity>>
    @Query("DELETE FROM tag") suspend fun clear()
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun insert(rows: List<TagEntity>)
    @Transaction suspend fun replaceAll(rows: List<TagEntity>) { clear(); insert(rows) }
}

@Dao
interface PendingOpDao {
    @Query("SELECT * FROM pending_op ORDER BY queuedAt") suspend fun all(): List<PendingOpEntity>
    @Query("SELECT * FROM pending_op ORDER BY queuedAt") fun observeAll(): Flow<List<PendingOpEntity>>
    @Query("SELECT * FROM pending_op WHERE promptId = :promptId") suspend fun get(promptId: Long): PendingOpEntity?
    @Upsert suspend fun put(op: PendingOpEntity)
    @Query("DELETE FROM pending_op WHERE promptId = :promptId") suspend fun remove(promptId: Long)
    @Query("UPDATE pending_op SET lastError = :msg WHERE promptId = :promptId") suspend fun setError(promptId: Long, msg: String?)
    @Query("UPDATE pending_op SET promptId = :new WHERE promptId = :old") suspend fun moveTo(old: Long, new: Long)
}

@Dao
interface SyncStateDao {
    @Query("SELECT * FROM sync_state WHERE `key` = 0") suspend fun get(): SyncStateEntity?
    @Query("SELECT * FROM sync_state WHERE `key` = 0") fun observe(): Flow<SyncStateEntity?>
    @Upsert suspend fun put(state: SyncStateEntity)
}
```

`CueDatabase.kt`:

```kotlin
package io.celox.cue.data.db

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import io.celox.cue.core.OpKind
import io.celox.cue.core.Priority
import io.celox.cue.core.Status

class Converters {
    @TypeConverter fun status(v: Status): String = v.name
    @TypeConverter fun status(v: String): Status = Status.valueOf(v)
    @TypeConverter fun priority(v: Priority): String = v.name
    @TypeConverter fun priority(v: String): Priority = Priority.valueOf(v)
    @TypeConverter fun kind(v: OpKind): String = v.name
    @TypeConverter fun kind(v: String): OpKind = OpKind.valueOf(v)
}

@Database(
    entities = [PromptEntity::class, ProjectEntity::class, TagEntity::class, PendingOpEntity::class, SyncStateEntity::class],
    version = 1,
    exportSchema = true,
)
@TypeConverters(Converters::class)
abstract class CueDatabase : RoomDatabase() {
    abstract fun promptDao(): PromptDao
    abstract fun projectDao(): ProjectDao
    abstract fun tagDao(): TagDao
    abstract fun pendingOpDao(): PendingOpDao
    abstract fun syncStateDao(): SyncStateDao

    /**
     * Nächste lokale (negative) ID. Im sync_state gezählt statt aus `min(id)`
     * abgeleitet: nach dem Hochschieben verschwindet die negative Zeile, und
     * `min(id)` gäbe dieselbe ID erneut aus — ein zweiter Offline-Prompt
     * überschriebe dann den Warteschlangen-Eintrag eines ersten.
     */
    fun nextLocalId(): Long = runInTransaction<Long> {
        val stmt = openHelper.writableDatabase
        stmt.execSQL("INSERT OR IGNORE INTO sync_state(`key`, cursor, lastSyncAt, lastError, nextLocalId) VALUES (0, NULL, NULL, NULL, -1)")
        val cursor = stmt.query("SELECT nextLocalId FROM sync_state WHERE `key` = 0")
        val id = cursor.use { it.moveToFirst(); it.getLong(0) }
        stmt.execSQL("UPDATE sync_state SET nextLocalId = nextLocalId - 1 WHERE `key` = 0")
        id
    }
}
```

⚠️ `clearAllTables()` setzt auch `nextLocalId` zurück — gewollt: nach einem Sperren gibt es keine alten negativen Zeilen mehr, mit denen eine ID kollidieren könnte.

- [ ] **Step 3: Grün**

Run: `./gradlew :app:testDebugUnitTest --tests 'io.celox.cue.data.db.*'` → PASS. Das exportierte Schema unter `android/app/schemas/` wird mit eingecheckt (künftige Migrationen brauchen es).

- [ ] **Step 4: Commit + Mutationsprobe**

```bash
git add android/app && git commit -m "feat(android): Room-Datenbank mit Warteschlange und lokalen IDs"
```

Mutation: in `nextLocalId` das `UPDATE … - 1` entfernen → `localIdsAreNegativeAndNeverRepeat` rot. In `replaceId` `delete(listOf(old))` entfernen → `replaceIdSwaps…` rot.

---

### Task 5: Netz — Server-URL, Token-Speicher, API-Client

**Files:**
- Create: `android/app/src/main/kotlin/io/celox/cue/core/ServerUrl.kt`
- Create: `android/app/src/main/kotlin/io/celox/cue/data/net/Dtos.kt`, `ApiResult.kt`, `CueApi.kt`
- Create: `android/app/src/main/kotlin/io/celox/cue/data/auth/TokenStore.kt`
- Test: `android/app/src/test/kotlin/io/celox/cue/core/ServerUrlTest.kt`, `android/app/src/test/kotlin/io/celox/cue/data/net/CueApiTest.kt`

**Interfaces:**
- Consumes: `Status`, `Priority` (Task 2)
- Produces:
  - `fun normalizeServerUrl(raw: String): String?` — `null` = ungültig; ohne Schema → `https://`, `http://` nur für `localhost`/`10.0.2.2`/private IPs, abschließende `/` entfernt
  - `interface TokenStore { val token: String?; val serverUrl: String; fun save(url: String, token: String); fun clear() }` + `EncryptedTokenStore(context)`
  - DTOs: `PromptDto`, `ProjectDto`, `TagDto`, `TagListDto(items)`, `ChangeFeedDto(cursor, changed)` — alle `@Serializable`, Feldnamen wie das Backend (`@SerialName("project_id")` usw.)
  - `sealed interface ApiResult<out T> { data class Ok<T>(val value: T); data class Http(val code: Int, val message: String); data class Network(val cause: Throwable) }` + `fun ApiResult<*>.code(): Int?` (Ok → 200, Http → code, Network → null)
  - `class CueApi(client: OkHttpClient, store: TokenStore)` mit `suspend fun prompts(): ApiResult<List<PromptDto>>`, `projects()`, `tags()`, `changes(since: String?, waitSeconds: Int): ApiResult<ChangeFeedDto>`, `create(fields: JsonObject): ApiResult<PromptDto>`, `patch(id: Long, fields: JsonObject): ApiResult<PromptDto>`
  - `fun PromptDto.toEntity(): PromptEntity`, `ProjectDto.toEntity()`, `TagDto.toEntity()`

- [ ] **Step 1: Failing tests**

`ServerUrlTest.kt`:

```kotlin
package io.celox.cue.core

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class ServerUrlTest {
    @Test fun `adds https and strips trailing slashes`() {
        assertThat(normalizeServerUrl("cue.celox.io")).isEqualTo("https://cue.celox.io")
        assertThat(normalizeServerUrl(" https://cue.celox.io/// ")).isEqualTo("https://cue.celox.io")
    }

    @Test fun `plain http is only allowed for local development`() {
        assertThat(normalizeServerUrl("http://cue.celox.io")).isNull()
        assertThat(normalizeServerUrl("http://10.0.2.2:8000")).isEqualTo("http://10.0.2.2:8000")
        assertThat(normalizeServerUrl("http://localhost:8000/")).isEqualTo("http://localhost:8000")
        assertThat(normalizeServerUrl("http://192.168.178.20:8000")).isEqualTo("http://192.168.178.20:8000")
    }

    @Test fun `garbage is rejected, not crashed on`() {
        for (raw in listOf("", "   ", "https://", "ftp://x", "https://cue.celox.io/api", "https://a b"))
            assertThat(normalizeServerUrl(raw)).named(raw).isNull()
    }
}
```

`CueApiTest.kt`:

```kotlin
package io.celox.cue.data.net

import com.google.common.truth.Truth.assertThat
import io.celox.cue.data.auth.TokenStore
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Before
import org.junit.Test
import java.util.concurrent.TimeUnit

class CueApiTest {
    private val server = MockWebServer()
    private lateinit var api: CueApi

    private class FakeStore(override var serverUrl: String, override var token: String?) : TokenStore {
        override fun save(url: String, token: String) { serverUrl = url; this.token = token }
        override fun clear() { token = null }
    }

    @Before fun start() {
        server.start()
        val client = OkHttpClient.Builder().readTimeout(2, TimeUnit.SECONDS).build()
        api = CueApi(client, FakeStore(server.url("/").toString().trimEnd('/'), "tok"))
    }

    @After fun stop() = server.shutdown()

    private val promptJson = """{"id":7,"title":"T","body":"B","project_id":null,"status":"queued",
        "sort_order":1,"tags":"a","bookmarked":false,"bookmark_order":0,"tested":false,"blocked":false,
        "priority":"high","test_closely":false,"created_at":"2026-09-24T10:00:00Z",
        "updated_at":"2026-09-24T10:00:00Z","ran_at":null,"attachments":[],"brand_new_field":1}"""

    @Test fun `sends the bearer token to app routes only and ignores unknown fields`() = runTest {
        server.enqueue(MockResponse().setBody("[$promptJson]"))
        val result = api.prompts()
        val req = server.takeRequest()
        assertThat(req.path).isEqualTo("/api/app/prompts")
        assertThat(req.getHeader("Authorization")).isEqualTo("Bearer tok")
        assertThat((result as ApiResult.Ok).value.single().priority).isEqualTo(io.celox.cue.core.Priority.high)
    }

    @Test fun `401 is an http result, a dropped connection is a network result`() = runTest {
        server.enqueue(MockResponse().setResponseCode(401))
        assertThat(api.prompts().code()).isEqualTo(401)
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))
        assertThat(api.prompts()).isInstanceOf(ApiResult.Network::class.java)
        assertThat(api.prompts().code()).isNull()
    }

    @Test fun `a timeout is a network result, never a 401`() = runTest {
        server.enqueue(MockResponse().setBody("[]").setBodyDelay(5, TimeUnit.SECONDS))
        assertThat(api.prompts()).isInstanceOf(ApiResult.Network::class.java)
    }

    @Test fun `patch sends exactly the given fields`() = runTest {
        server.enqueue(MockResponse().setBody(promptJson))
        api.patch(7, buildJsonObject { put("title", "neu") })
        val req = server.takeRequest()
        assertThat(req.method).isEqualTo("PATCH")
        assertThat(req.path).isEqualTo("/api/app/prompts/7")
        assertThat(req.body.readUtf8()).isEqualTo("""{"title":"neu"}""")
    }

    @Test fun `changes passes cursor and wait`() = runTest {
        server.enqueue(MockResponse().setBody("""{"cursor":"c2","changed":["prompts"]}"""))
        val r = api.changes(since = "c1", waitSeconds = 0) as ApiResult.Ok
        assertThat(server.takeRequest().path).isEqualTo("/api/app/changes?since=c1&wait=0")
        assertThat(r.value.changed).containsExactly("prompts")
    }

    @Test fun `no token means no request at all`() = runTest {
        val bare = CueApi(OkHttpClient(), FakeStore(server.url("/").toString().trimEnd('/'), null))
        assertThat(bare.prompts().code()).isEqualTo(401)
        assertThat(server.requestCount).isEqualTo(0)
    }
}
```

⚠️ Der „kein Token"-Fall antwortet mit einem **synthetischen 401**: für den Abgleich heißt es dasselbe wie eine Sperre (nichts zu tun, Einrichtung nötig), und es verhindert, dass ohne Token eine Anfrage hinausgeht.

Run → rot.

- [ ] **Step 2: `ServerUrl.kt`**

```kotlin
package io.celox.cue.core

import java.net.URI

private val LOCAL_HOST = Regex("""^(localhost|10\.0\.2\.2|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$""")

/** Eine eingegebene Server-Adresse in die Form bringen, die der Client voranstellt. */
fun normalizeServerUrl(raw: String): String? {
    var text = raw.trim().trimEnd('/')
    if (text.isEmpty()) return null
    if (!text.contains("://")) text = "https://$text"
    val uri = runCatching { URI(text) }.getOrNull() ?: return null
    val host = uri.host ?: return null
    if (!uri.path.isNullOrEmpty()) return null  // die App hängt /api/app/… selbst an
    return when (uri.scheme) {
        "https" -> text
        "http" -> if (LOCAL_HOST.matches(host)) text else null
        else -> null
    }
}
```

- [ ] **Step 3: `TokenStore.kt`**

```kotlin
package io.celox.cue.data.auth

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

interface TokenStore {
    val token: String?
    val serverUrl: String
    fun save(url: String, token: String)
    fun clear()
}

const val DEFAULT_SERVER = "https://cue.celox.io"

/** Token + URL, verschlüsselt mit einem Schlüssel aus dem Android-Keystore. */
class EncryptedTokenStore(context: Context) : TokenStore {
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "cue-auth",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    override val token: String? get() = prefs.getString("token", null)
    override val serverUrl: String get() = prefs.getString("url", null) ?: DEFAULT_SERVER

    override fun save(url: String, token: String) {
        prefs.edit().putString("url", url).putString("token", token).apply()
    }

    override fun clear() {
        prefs.edit().remove("token").apply()
    }
}
```

- [ ] **Step 4: DTOs, ApiResult, CueApi**

`ApiResult.kt`:

```kotlin
package io.celox.cue.data.net

sealed interface ApiResult<out T> {
    data class Ok<T>(val value: T) : ApiResult<T>
    data class Http(val code: Int, val message: String) : ApiResult<Nothing>
    data class Network(val cause: Throwable) : ApiResult<Nothing>
}

fun ApiResult<*>.code(): Int? = when (this) {
    is ApiResult.Ok -> 200
    is ApiResult.Http -> code
    is ApiResult.Network -> null
}
```

`Dtos.kt`:

```kotlin
package io.celox.cue.data.net

import io.celox.cue.core.Priority
import io.celox.cue.core.Status
import io.celox.cue.data.db.ProjectEntity
import io.celox.cue.data.db.PromptEntity
import io.celox.cue.data.db.TagEntity
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class PromptDto(
    val id: Long,
    val title: String,
    val body: String,
    @SerialName("project_id") val projectId: Long? = null,
    val status: Status,
    @SerialName("sort_order") val sortOrder: Int,
    val tags: String = "",
    val bookmarked: Boolean = false,
    val priority: Priority = Priority.normal,
    val blocked: Boolean = false,
    val tested: Boolean = false,
    @SerialName("test_closely") val testClosely: Boolean = false,
    @SerialName("updated_at") val updatedAt: String,
)

@Serializable
data class ProjectDto(val id: Long, val name: String, val color: String = "", @SerialName("sort_order") val sortOrder: Int = 0)

@Serializable
data class TagDto(val id: Long, val name: String, @SerialName("usage_count") val usageCount: Int = 0)

@Serializable
data class TagListDto(val items: List<TagDto>)

@Serializable
data class ChangeFeedDto(val cursor: String, val changed: List<String> = emptyList())

fun PromptDto.toEntity() = PromptEntity(
    id, title, body, projectId, status, sortOrder, tags, bookmarked, priority, blocked, tested, testClosely, updatedAt,
)

fun ProjectDto.toEntity() = ProjectEntity(id, name, color, sortOrder)
fun TagDto.toEntity() = TagEntity(id, name, usageCount)
```

`CueApi.kt`:

```kotlin
package io.celox.cue.data.net

import io.celox.cue.data.auth.TokenStore
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** Spricht ausschließlich `/api/app/*`. Einen anderen Pfad kennt die App nicht. */
class CueApi(private val client: OkHttpClient, private val store: TokenStore) {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val jsonType = "application/json".toMediaType()

    private suspend fun <T> call(
        method: String,
        path: String,
        body: JsonObject? = null,
        query: Map<String, String> = emptyMap(),
        serializer: KSerializer<T>,
    ): ApiResult<T> = withContext(Dispatchers.IO) {
        val token = store.token ?: return@withContext ApiResult.Http(401, "Kein Token")
        val base = "${store.serverUrl}/api/app$path".toHttpUrlOrNull()
            ?: return@withContext ApiResult.Http(400, "Server-Adresse ungültig")
        val url = base.newBuilder().apply { query.forEach { (k, v) -> addQueryParameter(k, v) } }.build()
        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $token")
            .method(method, body?.let { it.toString().toRequestBody(jsonType) })
            .build()
        try {
            client.newCall(request).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) return@use ApiResult.Http(resp.code, text.take(300))
                ApiResult.Ok(json.decodeFromString(serializer, text))
            }
        } catch (e: IOException) {
            ApiResult.Network(e)
        }
    }

    suspend fun prompts() = call("GET", "/prompts", serializer = ListSerializer(PromptDto.serializer()))
    suspend fun projects() = call("GET", "/projects", serializer = ListSerializer(ProjectDto.serializer()))
    suspend fun tags() = call("GET", "/tags", serializer = TagListDto.serializer())

    suspend fun changes(since: String?, waitSeconds: Int) = call(
        "GET", "/changes",
        query = buildMap { if (since != null) put("since", since); put("wait", waitSeconds.toString()) },
        serializer = ChangeFeedDto.serializer(),
    )

    suspend fun create(fields: JsonObject) = call("POST", "/prompts", fields, serializer = PromptDto.serializer())
    suspend fun patch(id: Long, fields: JsonObject) = call("PATCH", "/prompts/$id", fields, serializer = PromptDto.serializer())
}
```

⚠️ Für den Long-Poll braucht der `OkHttpClient` eine `readTimeout` von mindestens `wait + 15` s (Task 7 baut ihn so) — sonst bricht der Client die Anfrage ab, die er selbst offen halten ließ (dieselbe Falle wie beim Runner, CLAUDE.md „Long polling").

- [ ] **Step 5: Grün, Commit, Mutationsprobe**

Run: `./gradlew :app:testDebugUnitTest --tests 'io.celox.cue.core.ServerUrlTest' --tests 'io.celox.cue.data.net.*'` → PASS

```bash
git add android/app && git commit -m "feat(android): API-Client fuer /api/app, Token verschluesselt abgelegt"
```

Mutationen: `ignoreUnknownKeys = true` → `false` (Test mit `brand_new_field` rot); `catch (e: IOException)` → `catch (e: IllegalStateException)` (Timeout-/Disconnect-Tests rot); in `normalizeServerUrl` den `http`-Zweig auf `text` (http-Test rot).

---

### Task 6: `SyncEngine` — schieben, ziehen, sperren

**Files:**
- Create: `android/app/src/main/kotlin/io/celox/cue/data/sync/SyncEngine.kt`
- Test: `android/app/src/test/kotlin/io/celox/cue/data/sync/SyncEngineTest.kt`

**Interfaces:**
- Consumes: `classify`, `planMerge`, `coalesce`, `QueuedOp`, `OpKind`, `Outcome` (Task 3); `CueDatabase` + DAOs (Task 4); `CueApi`, `ApiResult`, DTOs, `toEntity()`, `TokenStore` (Task 5)
- Produces:
  - `interface AppApi` (die sechs Methoden von `CueApi` als Interface; `CueApi : AppApi`) — damit Tests einen Fake einsetzen
  - `sealed interface SyncResult { object Done; object Offline; object Revoked; object NotConfigured }`
  - `class SyncEngine(db: CueDatabase, api: AppApi, store: TokenStore, now: () -> Long = System::currentTimeMillis)` mit
    - `suspend fun enqueue(promptId: Long, kind: OpKind, fields: JsonObject)` — `coalesce` + in `pending_op` schreiben, **und** die lokale Zeile sofort anpassen
    - `suspend fun sync(): SyncResult` — erst schieben, dann ziehen
    - `suspend fun wipe()` — Datenbank leeren + Token verwerfen

Zuerst in `CueApi.kt` das Interface herausziehen:

```kotlin
interface AppApi {
    suspend fun prompts(): ApiResult<List<PromptDto>>
    suspend fun projects(): ApiResult<List<ProjectDto>>
    suspend fun tags(): ApiResult<TagListDto>
    suspend fun changes(since: String?, waitSeconds: Int): ApiResult<ChangeFeedDto>
    suspend fun create(fields: JsonObject): ApiResult<PromptDto>
    suspend fun patch(id: Long, fields: JsonObject): ApiResult<PromptDto>
}
```

und `class CueApi(…) : AppApi` mit `override` an den sechs Methoden (explizite Rückgabetypen wie im Interface).

- [ ] **Step 1: Failing tests**

```kotlin
package io.celox.cue.data.sync

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import io.celox.cue.core.OpKind
import io.celox.cue.core.Priority
import io.celox.cue.core.Status
import io.celox.cue.data.auth.TokenStore
import io.celox.cue.data.db.CueDatabase
import io.celox.cue.data.net.ApiResult
import io.celox.cue.data.net.AppApi
import io.celox.cue.data.net.ChangeFeedDto
import io.celox.cue.data.net.ProjectDto
import io.celox.cue.data.net.PromptDto
import io.celox.cue.data.net.TagListDto
import java.io.IOException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SyncEngineTest {
    private lateinit var db: CueDatabase
    private lateinit var api: FakeApi
    private lateinit var store: FakeStore
    private lateinit var engine: SyncEngine

    class FakeStore : TokenStore {
        override var token: String? = "tok"
        override var serverUrl = "https://cue.celox.io"
        override fun save(url: String, token: String) { serverUrl = url; this.token = token }
        override fun clear() { token = null }
    }

    /** Ein Server im Speicher; `down` simuliert Funkloch, `status` erzwingt Codes. */
    class FakeApi : AppApi {
        val rows = linkedMapOf<Long, PromptDto>()
        var nextId = 100L
        var down = false
        var failPrompts = false
        var forced: Int? = null
        val rejectPatchFor = mutableSetOf<Long>()
        val calls = mutableListOf<String>()
        var cursor = 0

        private fun <T> guard(label: String, block: () -> ApiResult<T>): ApiResult<T> {
            calls += label
            if (down) return ApiResult.Network(IOException("offline"))
            forced?.let { return ApiResult.Http(it, "") }
            return block()
        }

        fun dto(id: Long, title: String, body: String = "b") = PromptDto(
            id = id, title = title, body = body, status = Status.queued, sortOrder = 0,
            priority = Priority.normal, updatedAt = "2026-09-24T10:00:00Z",
        )

        override suspend fun prompts() = guard("prompts") {
            if (failPrompts) ApiResult.Network(IOException("Funkloch")) else ApiResult.Ok(rows.values.toList())
        }
        override suspend fun projects() = guard("projects") { ApiResult.Ok(emptyList<ProjectDto>()) }
        override suspend fun tags() = guard("tags") { ApiResult.Ok(TagListDto(emptyList())) }
        override suspend fun changes(since: String?, waitSeconds: Int) = guard("changes") {
            ApiResult.Ok(ChangeFeedDto("c$cursor", if (since == "c$cursor") emptyList() else listOf("prompts")))
        }
        override suspend fun create(fields: JsonObject) = guard("create") {
            val id = nextId++
            val d = dto(id, fields["title"]?.jsonPrimitive?.content.orEmpty(), fields["body"]!!.jsonPrimitive.content)
            rows[id] = d; cursor++
            ApiResult.Ok(d)
        }
        override suspend fun patch(id: Long, fields: JsonObject) = guard("patch:$id") {
            if (id in rejectPatchFor) return@guard ApiResult.Http(422, "nein")
            val old = rows[id] ?: return@guard ApiResult.Http(404, "")
            val d = old.copy(title = fields["title"]?.jsonPrimitive?.content ?: old.title)
            rows[id] = d; cursor++
            ApiResult.Ok(d)
        }
    }

    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), CueDatabase::class.java)
            .allowMainThreadQueries().build()
        api = FakeApi()
        store = FakeStore()
        engine = SyncEngine(db, api, store)
    }

    @After fun tearDown() = db.close()

    private fun f(vararg p: Pair<String, String>) = buildJsonObject { p.forEach { (k, v) -> put(k, v) } }

    @Test fun `a pull fills the local database`() = runTest {
        api.rows[1] = api.dto(1, "vom Server")
        assertThat(engine.sync()).isEqualTo(SyncResult.Done)
        assertThat(db.promptDao().get(1)!!.title).isEqualTo("vom Server")
    }

    @Test fun `an offline create then edit goes out as ONE post with the final state`() = runTest {
        val local = db.nextLocalId()
        engine.enqueue(local, OpKind.CREATE, f("body" to "Text", "title" to ""))
        engine.enqueue(local, OpKind.UPDATE, f("title" to "Endtitel"))
        assertThat(engine.sync()).isEqualTo(SyncResult.Done)
        assertThat(api.calls.count { it == "create" }).isEqualTo(1)
        assertThat(api.calls.none { it.startsWith("patch:") }).isTrue()
        val row = api.rows.values.single()
        assertThat(row.title).isEqualTo("Endtitel")
        // Lokal steht jetzt die Server-ID, keine negative mehr.
        assertThat(db.promptDao().ids()).containsExactly(row.id)
        assertThat(db.pendingOpDao().all()).isEmpty()
    }

    @Test fun `offline, nothing is lost and nothing is deleted`() = runTest {
        api.rows[1] = api.dto(1, "a"); engine.sync()
        engine.enqueue(1, OpKind.UPDATE, f("title" to "lokal"))
        api.down = true
        assertThat(engine.sync()).isEqualTo(SyncResult.Offline)
        assertThat(db.promptDao().get(1)!!.title).isEqualTo("lokal")
        assertThat(db.pendingOpDao().all()).hasSize(1)
        assertThat(store.token).isEqualTo("tok")
    }

    @Test fun `revoked wipes the copy, the queue and the token`() = runTest {
        api.rows[1] = api.dto(1, "a"); engine.sync()
        engine.enqueue(1, OpKind.UPDATE, f("title" to "unterwegs"))
        api.forced = 401
        assertThat(engine.sync()).isEqualTo(SyncResult.Revoked)
        assertThat(db.promptDao().ids()).isEmpty()
        assertThat(db.pendingOpDao().all()).isEmpty()
        assertThat(store.token).isNull()
    }

    @Test fun `403 is treated like 401`() = runTest {
        api.rows[1] = api.dto(1, "a"); engine.sync()
        api.forced = 403
        assertThat(engine.sync()).isEqualTo(SyncResult.Revoked)
        assertThat(db.promptDao().ids()).isEmpty()
    }

    @Test fun `a 5xx is never mistaken for revoked`() = runTest {
        api.rows[1] = api.dto(1, "a"); engine.sync()
        api.forced = 503
        assertThat(engine.sync()).isEqualTo(SyncResult.Offline)
        assertThat(db.promptDao().ids()).containsExactly(1L)
    }

    @Test fun `a rejected change stays queued with its error and does not block others`() = runTest {
        api.rows[1] = api.dto(1, "a"); api.rows[2] = api.dto(2, "b"); engine.sync()
        api.rejectPatchFor += 1
        engine.enqueue(1, OpKind.UPDATE, f("title" to "abgelehnt"))
        engine.enqueue(2, OpKind.UPDATE, f("title" to "geht durch"))
        assertThat(engine.sync()).isEqualTo(SyncResult.Done)
        assertThat(api.rows[2]!!.title).isEqualTo("geht durch")
        val stuck = db.pendingOpDao().get(1)!!
        assertThat(stuck.lastError).contains("422")
        // Und die lokale Fassung wurde vom Ziehen NICHT überschrieben.
        assertThat(db.promptDao().get(1)!!.title).isEqualTo("abgelehnt")
    }

    @Test fun `a pull does not overwrite a row with a pending change`() = runTest {
        api.rows[1] = api.dto(1, "a"); engine.sync()
        engine.enqueue(1, OpKind.UPDATE, f("title" to "lokal"))
        api.rows[1] = api.dto(1, "vom Rechner"); api.cursor++
        api.down = false
        // Nur ziehen, nicht schieben: der Eintrag ist vorher abgelehnt worden.
        api.rejectPatchFor += 1
        engine.sync()
        assertThat(db.promptDao().get(1)!!.title).isEqualTo("lokal")
    }

    @Test fun `a prompt deleted on the server disappears locally`() = runTest {
        api.rows[1] = api.dto(1, "a"); api.rows[2] = api.dto(2, "b"); engine.sync()
        api.rows.remove(2); api.cursor++
        engine.sync()
        assertThat(db.promptDao().ids()).containsExactly(1L)
    }

    @Test fun `a drop between changes and prompts does not swallow the change`() = runTest {
        api.rows[1] = api.dto(1, "a"); engine.sync()
        api.rows[2] = api.dto(2, "neu am Rechner"); api.cursor++
        api.failPrompts = true
        assertThat(engine.sync()).isEqualTo(SyncResult.Offline)
        api.failPrompts = false
        engine.sync()
        // Hätte der Cursor schon nach `changes` gestanden, meldete der zweite
        // Lauf „nichts geändert" und Prompt 2 käme nie an.
        assertThat(db.promptDao().ids()).containsExactly(1L, 2L)
    }

    @Test fun `without a token nothing is sent`() = runTest {
        store.token = null
        assertThat(engine.sync()).isEqualTo(SyncResult.NotConfigured)
        assertThat(api.calls).isEmpty()
    }

    @Test fun `enqueue updates the local row at once`() = runTest {
        api.rows[1] = api.dto(1, "a"); engine.sync()
        engine.enqueue(1, OpKind.UPDATE, f("title" to "sofort"))
        assertThat(db.promptDao().observe(1).first()!!.title).isEqualTo("sofort")
    }
}
```

Run: `./gradlew :app:testDebugUnitTest --tests 'io.celox.cue.data.sync.*'` → rot.

- [ ] **Step 2: Implementieren**

```kotlin
package io.celox.cue.data.sync

import io.celox.cue.core.OpKind
import io.celox.cue.core.Outcome
import io.celox.cue.core.Priority
import io.celox.cue.core.QueuedOp
import io.celox.cue.core.Status
import io.celox.cue.core.classify
import io.celox.cue.core.coalesce
import io.celox.cue.core.planMerge
import io.celox.cue.data.auth.TokenStore
import io.celox.cue.data.db.CueDatabase
import io.celox.cue.data.db.PendingOpEntity
import io.celox.cue.data.db.PromptEntity
import io.celox.cue.data.db.SyncStateEntity
import io.celox.cue.data.net.ApiResult
import io.celox.cue.data.net.AppApi
import io.celox.cue.data.net.code
import io.celox.cue.data.net.toEntity
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull

sealed interface SyncResult {
    data object Done : SyncResult
    data object Offline : SyncResult
    data object Revoked : SyncResult
    data object NotConfigured : SyncResult
}

/**
 * Schieben, dann ziehen. Eine Instanz, ein Mutex — ein Arbeiter im Hintergrund
 * und ein Poll im Vordergrund dürfen nie gleichzeitig dieselbe Warteschlange
 * abarbeiten.
 */
class SyncEngine(
    private val db: CueDatabase,
    private val api: AppApi,
    private val store: TokenStore,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val mutex = Mutex()

    private class RevokedSignal : RuntimeException()

    suspend fun enqueue(promptId: Long, kind: OpKind, fields: JsonObject) = mutex.withLock {
        val dao = db.pendingOpDao()
        val existing = dao.get(promptId)?.let {
            QueuedOp(it.promptId, it.kind, Json.parseToJsonElement(it.fieldsJson).jsonObject)
        }
        val merged = coalesce(existing, QueuedOp(promptId, kind, fields))
        dao.put(PendingOpEntity(promptId, merged.kind, merged.fields.toString(), null, existing?.let { dao.get(promptId)!!.queuedAt } ?: now()))
        applyLocally(promptId, fields)
    }

    /** Die Oberfläche liest aus Room — also muss die Änderung dort sofort stehen. */
    private suspend fun applyLocally(id: Long, f: JsonObject) {
        val dao = db.promptDao()
        val base = dao.get(id) ?: PromptEntity(
            id = id, title = "", body = "", projectId = null, status = Status.queued, sortOrder = Int.MIN_VALUE,
            tags = "", bookmarked = false, priority = Priority.normal, blocked = false, tested = false,
            testClosely = false, updatedAt = "",
        )
        fun str(k: String) = (f[k] as? JsonPrimitive)?.contentOrNull
        val unassign = (f["unassign_project"] as? JsonPrimitive)?.booleanOrNull == true
        dao.upsert(listOf(base.copy(
            title = str("title") ?: base.title,
            body = str("body") ?: base.body,
            tags = str("tags") ?: base.tags,
            projectId = if (unassign) null else (f["project_id"] as? JsonPrimitive)?.longOrNull ?: base.projectId,
            status = str("status")?.let(Status::valueOf) ?: base.status,
            priority = str("priority")?.let(Priority::valueOf) ?: base.priority,
            bookmarked = (f["bookmarked"] as? JsonPrimitive)?.booleanOrNull ?: base.bookmarked,
        )))
    }

    suspend fun sync(): SyncResult = mutex.withLock {
        if (store.token == null) return SyncResult.NotConfigured
        try {
            if (!push()) return SyncResult.Offline
            return pull()
        } catch (_: RevokedSignal) {
            wipeLocked()
            return SyncResult.Revoked
        }
    }

    suspend fun wipe() = mutex.withLock { wipeLocked() }

    private fun wipeLocked() {
        db.clearAllTables()
        store.clear()
    }

    /** false = offline, Rest später. Wirft RevokedSignal bei 401/403. */
    private suspend fun push(): Boolean {
        val ops = db.pendingOpDao()
        for (op in ops.all()) {
            val fields = Json.parseToJsonElement(op.fieldsJson).jsonObject
            val result = if (op.kind == OpKind.CREATE) api.create(fields) else api.patch(op.promptId, fields)
            when (val outcome = classify(result.code())) {
                Outcome.Ok -> {
                    val row = (result as ApiResult.Ok).value.toEntity()
                    if (op.kind == OpKind.CREATE) db.promptDao().replaceId(op.promptId, row)
                    else db.promptDao().upsert(listOf(row))
                    ops.remove(op.promptId)
                }
                Outcome.Offline -> return false
                Outcome.Revoked -> throw RevokedSignal()
                is Outcome.Rejected -> {
                    val msg = (result as? ApiResult.Http)?.message.orEmpty()
                    ops.setError(op.promptId, "${outcome.code} $msg".trim())
                }
            }
        }
        return true
    }

    private suspend fun pull(): SyncResult {
        val state = db.syncStateDao().get()
        val feed = api.changes(since = state?.cursor, waitSeconds = 0)
        when (classify(feed.code())) {
            Outcome.Offline -> return SyncResult.Offline
            Outcome.Revoked -> throw RevokedSignal()
            else -> Unit
        }
        val body = (feed as? ApiResult.Ok)?.value ?: return SyncResult.Offline
        // Erster Lauf (kein Cursor): alles holen.
        val want = if (state?.cursor == null) setOf("prompts", "projects", "tags") else body.changed.toSet()

        if ("prompts" in want) {
            val r = api.prompts()
            when (classify(r.code())) { Outcome.Revoked -> throw RevokedSignal(); Outcome.Ok -> Unit; else -> return SyncResult.Offline }
            val server = (r as ApiResult.Ok).value
            val pending = db.pendingOpDao().all().map { it.promptId }.toSet()
            val plan = planMerge(server.map { it.id }.toSet(), db.promptDao().ids().toSet(), pending)
            val byId = server.associateBy { it.id }
            db.promptDao().upsert(plan.upsert.map { byId.getValue(it).toEntity() })
            if (plan.delete.isNotEmpty()) db.promptDao().delete(plan.delete)
        }
        if ("projects" in want) {
            val r = api.projects()
            when (classify(r.code())) { Outcome.Revoked -> throw RevokedSignal(); Outcome.Ok -> Unit; else -> return SyncResult.Offline }
            db.projectDao().replaceAll((r as ApiResult.Ok).value.map { it.toEntity() })
        }
        if ("tags" in want) {
            val r = api.tags()
            when (classify(r.code())) { Outcome.Revoked -> throw RevokedSignal(); Outcome.Ok -> Unit; else -> return SyncResult.Offline }
            db.tagDao().replaceAll((r as ApiResult.Ok).value.items.map { it.toEntity() })
        }
        // Cursor erst NACH erfolgreichem Holen fortschreiben — sonst verschluckt
        // ein Funkloch mitten im Holen die Änderung für immer.
        db.syncStateDao().put(
            (state ?: SyncStateEntity(cursor = null, lastSyncAt = null, lastError = null))
                .copy(cursor = body.cursor, lastSyncAt = now(), lastError = null)
        )
        return SyncResult.Done
    }
}
```

⚠️ Zwei Stellen, die leicht falsch werden:
- `db.syncStateDao().put(state.copy(…))` muss `nextLocalId` aus dem bestehenden Zustand **erhalten** — deshalb `state.copy`, nie ein frisches `SyncStateEntity(…)`, wenn `state` existiert. Sonst beginnt die lokale ID-Zählung wieder bei −1 und ein zweiter Offline-Prompt überschreibt einen ersten.
- `clearAllTables()` darf nicht auf dem Main-Thread laufen; `sync()` wird aus Worker/ViewModel auf `Dispatchers.IO` gerufen (Task 7). In den Tests erlaubt `allowMainThreadQueries()` es.

In `enqueue` wird `queuedAt` beim Zusammenfassen vom bestehenden Eintrag übernommen (die Reihenfolge der Warteschlange bleibt die der ersten Änderung).

- [ ] **Step 3: Grün**

Run: `./gradlew :app:testDebugUnitTest --tests 'io.celox.cue.data.sync.*'` → PASS. Dann die ganze Suite: `./gradlew :app:testDebugUnitTest`.

- [ ] **Step 4: Commit + Mutationsprobe**

```bash
git add android/app && git commit -m "feat(android): SyncEngine — schieben, ziehen, bei Sperre alles loeschen"
```

Mutationen (jeweils rot sehen, dann `git checkout -- android/`):
1. In `push` `Outcome.Offline -> return false` → `Outcome.Offline -> throw RevokedSignal()` → `offline, nothing is lost…` rot.
2. `is Outcome.Rejected -> { … }` → `return false` → `a rejected change … does not block others` rot.
3. In `pull` `pending` durch `emptySet()` ersetzen → `a pull does not overwrite…` rot.
4. `wipeLocked` ohne `store.clear()` → `revoked wipes…` rot.
5. Das `db.syncStateDao().put(…)` an den Anfang von `pull` (direkt nach dem Lesen von `body`) ziehen → `a drop between changes and prompts…` rot.

---

### Task 7: Hintergrund und Vordergrund — Worker, Live-Poll, DI, Repository

**Files:**
- Create: `android/app/src/main/kotlin/io/celox/cue/data/sync/SyncWorker.kt`
- Create: `android/app/src/main/kotlin/io/celox/cue/data/PromptRepository.kt`
- Create: `android/app/src/main/kotlin/io/celox/cue/di/AppModule.kt`
- Test: `android/app/src/test/kotlin/io/celox/cue/data/sync/SyncWorkerTest.kt`

**Interfaces:**
- Consumes: `SyncEngine`, `SyncResult` (Task 6), `CueDatabase`, `CueApi`, `EncryptedTokenStore`, `normalizeServerUrl`
- Produces:
  - `SyncWorker` (`@HiltWorker`): `Result.success()` bei Done/NotConfigured/Revoked, `Result.retry()` bei Offline; `SyncWorker.schedule(context)` (periodisch 15 min, `NetworkType.CONNECTED`) und `SyncWorker.kick(context)` (einmalig, unique `REPLACE`)
  - `class PromptRepository @Inject constructor(db, engine, api, store, @ApplicationContext ctx)` mit:
    - `val prompts: Flow<List<PromptEntity>>`, `val projects: Flow<List<ProjectEntity>>`, `val tags: Flow<List<TagEntity>>`, `val pending: Flow<List<PendingOpEntity>>`, `val syncState: Flow<SyncStateEntity?>`
    - `fun prompt(id: Long): Flow<PromptEntity?>`
    - `suspend fun create(title: String, body: String, projectId: Long?, tags: String): Long` (liefert die lokale ID)
    - `suspend fun update(id: Long, fields: JsonObject)`
    - `suspend fun syncNow(): SyncResult`
    - `suspend fun connect(rawUrl: String, token: String): ConnectResult` (`Ok`, `BadUrl`, `Rejected`, `Offline`)
    - `suspend fun disconnect()`
    - `suspend fun liveLoop()` — solange aufgerufen: `changes(wait=25)`, bei Meldung `syncNow()`; bei Offline Backoff 1→30 s
  - `sealed interface ConnectResult { object Ok; object BadUrl; object Rejected; object Offline }`

- [ ] **Step 1: Failing test für den Worker**

```kotlin
package io.celox.cue.data.sync

import androidx.work.ListenableWorker
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SyncWorkerTest {
    private fun resultFor(outcome: SyncResult) = SyncWorker.mapResult(outcome)

    @Test fun `offline retries, everything else is done`() {
        assertThat(resultFor(SyncResult.Offline)).isEqualTo(ListenableWorker.Result.retry())
        assertThat(resultFor(SyncResult.Done)).isEqualTo(ListenableWorker.Result.success())
        // Gesperrt: kein Wiederholen — es gibt nichts mehr zu schieben, und ein
        // Retry-Sturm gegen 401 wäre sinnlose Last.
        assertThat(resultFor(SyncResult.Revoked)).isEqualTo(ListenableWorker.Result.success())
        assertThat(resultFor(SyncResult.NotConfigured)).isEqualTo(ListenableWorker.Result.success())
    }
}
```

(Die Abbildung ist eine reine Funktion auf dem Companion, damit der Test ohne Hilt-Fabrik auskommt.)

- [ ] **Step 2: `SyncWorker.kt`**

```kotlin
package io.celox.cue.data.sync

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ListenableWorker
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val engine: SyncEngine,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = mapResult(withContext(Dispatchers.IO) { engine.sync() })

    companion object {
        private const val PERIODIC = "cue-sync"
        private const val ONCE = "cue-sync-now"
        private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun mapResult(r: SyncResult): ListenableWorker.Result =
            if (r == SyncResult.Offline) ListenableWorker.Result.retry() else ListenableWorker.Result.success()

        fun schedule(context: Context) {
            val req = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(online).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, req)
        }

        /** Nach jeder lokalen Änderung: sobald Netz da ist, raus damit. */
        fun kick(context: Context) {
            val req = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(online)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(ONCE, ExistingWorkPolicy.REPLACE, req)
        }
    }
}
```

- [ ] **Step 3: DI**

`di/AppModule.kt`:

```kotlin
package io.celox.cue.di

import android.content.Context
import androidx.room.Room
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import io.celox.cue.data.auth.EncryptedTokenStore
import io.celox.cue.data.auth.TokenStore
import io.celox.cue.data.db.CueDatabase
import io.celox.cue.data.net.AppApi
import io.celox.cue.data.net.CueApi
import io.celox.cue.data.sync.SyncEngine
import java.util.concurrent.TimeUnit
import javax.inject.Singleton
import okhttp3.OkHttpClient

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    /** Long-Poll wartet bis 25 s; der Client muss länger warten als der Server. */
    const val LIVE_WAIT_S = 25

    @Provides @Singleton
    fun db(@ApplicationContext c: Context): CueDatabase =
        Room.databaseBuilder(c, CueDatabase::class.java, "cue.db").build()

    @Provides @Singleton
    fun store(@ApplicationContext c: Context): TokenStore = EncryptedTokenStore(c)

    @Provides @Singleton
    fun client(): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout((LIVE_WAIT_S + 15).toLong(), TimeUnit.SECONDS)
        .build()

    @Provides @Singleton
    fun api(client: OkHttpClient, store: TokenStore): AppApi = CueApi(client, store)

    @Provides @Singleton
    fun engine(db: CueDatabase, api: AppApi, store: TokenStore) = SyncEngine(db, api, store)
}
```

- [ ] **Step 4: `PromptRepository.kt`**

```kotlin
package io.celox.cue.data

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import io.celox.cue.core.OpKind
import io.celox.cue.core.Outcome
import io.celox.cue.core.classify
import io.celox.cue.core.normalizeServerUrl
import io.celox.cue.data.auth.TokenStore
import io.celox.cue.data.db.CueDatabase
import io.celox.cue.data.net.ApiResult
import io.celox.cue.data.net.AppApi
import io.celox.cue.data.net.code
import io.celox.cue.data.sync.SyncEngine
import io.celox.cue.data.sync.SyncResult
import io.celox.cue.data.sync.SyncWorker
import io.celox.cue.di.AppModule
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import kotlin.coroutines.coroutineContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

sealed interface ConnectResult {
    data object Ok : ConnectResult
    data object BadUrl : ConnectResult
    data object Rejected : ConnectResult
    data object Offline : ConnectResult
}

@Singleton
class PromptRepository @Inject constructor(
    private val db: CueDatabase,
    private val engine: SyncEngine,
    private val api: AppApi,
    private val store: TokenStore,
    @ApplicationContext private val context: Context,
) {
    val prompts = db.promptDao().observeAll()
    val projects = db.projectDao().observeAll()
    val tags = db.tagDao().observeAll()
    val pending = db.pendingOpDao().observeAll()
    val syncState = db.syncStateDao().observe()
    val isConfigured: Boolean get() = store.token != null
    val serverUrl: String get() = store.serverUrl

    fun prompt(id: Long) = db.promptDao().observe(id)

    suspend fun create(title: String, body: String, projectId: Long?, tags: String): Long = withContext(Dispatchers.IO) {
        val id = db.nextLocalId()
        engine.enqueue(id, OpKind.CREATE, buildJsonObject {
            put("title", title); put("body", body); put("tags", tags)
            if (projectId != null) put("project_id", projectId)
        })
        SyncWorker.kick(context)
        id
    }

    suspend fun update(id: Long, fields: JsonObject) = withContext(Dispatchers.IO) {
        engine.enqueue(id, OpKind.UPDATE, fields)
        SyncWorker.kick(context)
    }

    suspend fun syncNow(): SyncResult = withContext(Dispatchers.IO) { engine.sync() }

    /** Token prüfen, BEVOR er gespeichert wird: ein Tippfehler soll nicht erst im Hintergrund auffallen. */
    suspend fun connect(rawUrl: String, token: String): ConnectResult = withContext(Dispatchers.IO) {
        val url = normalizeServerUrl(rawUrl) ?: return@withContext ConnectResult.BadUrl
        val previous = store.token to store.serverUrl
        store.save(url, token.trim())
        when (classify(api.changes(since = null, waitSeconds = 0).code())) {
            Outcome.Ok -> { engine.sync(); SyncWorker.schedule(context); ConnectResult.Ok }
            Outcome.Revoked, is Outcome.Rejected -> {
                if (previous.first != null) store.save(previous.second, previous.first!!) else store.clear()
                ConnectResult.Rejected
            }
            Outcome.Offline -> {
                if (previous.first != null) store.save(previous.second, previous.first!!) else store.clear()
                ConnectResult.Offline
            }
        }
    }

    suspend fun disconnect() = withContext(Dispatchers.IO) { engine.wipe() }

    /** Solange die App sichtbar ist: warten, bis sich etwas ändert, dann abgleichen. */
    suspend fun liveLoop() {
        var backoff = 1_000L
        while (coroutineContext.isActive && store.token != null) {
            val since = withContext(Dispatchers.IO) { db.syncStateDao().get()?.cursor }
            val feed = withContext(Dispatchers.IO) { api.changes(since, AppModule.LIVE_WAIT_S) }
            when (classify(feed.code())) {
                Outcome.Ok -> {
                    backoff = 1_000L
                    if (since == null || (feed as ApiResult.Ok).value.changed.isNotEmpty()) syncNow()
                }
                Outcome.Revoked -> { syncNow(); return }  // die Engine räumt ab
                else -> { delay(backoff); backoff = (backoff * 2).coerceAtMost(30_000L) }
            }
        }
    }
}
```

⚠️ `liveLoop` ruft bei `Revoked` **die Engine** auf, statt selbst zu löschen: das Abräumen soll genau eine Stelle haben.

- [ ] **Step 5: Grün + Build**

Run: `./gradlew :app:testDebugUnitTest :app:assembleDebug` → PASS / BUILD SUCCESSFUL (Hilt-Graph kompiliert).

- [ ] **Step 6: Commit + Mutationsprobe**

```bash
git add android/app && git commit -m "feat(android): Hintergrund-Abgleich und Live-Poll im Vordergrund"
```

Mutation: `mapResult` gibt immer `success()` → Test rot.

---

### Task 8: Oberfläche — Liste, Detail, Bearbeiten, Einstellungen

**Files:**
- Create: `android/app/src/main/kotlin/io/celox/cue/ui/theme/Theme.kt`
- Create: `android/app/src/main/kotlin/io/celox/cue/ui/CueApp.kt`
- Modify: `android/app/src/main/kotlin/io/celox/cue/ui/MainActivity.kt`
- Create: `ui/list/ListViewModel.kt`, `ui/list/ListScreen.kt`, `ui/detail/DetailScreen.kt`, `ui/edit/EditViewModel.kt`, `ui/edit/EditScreen.kt`, `ui/settings/SettingsViewModel.kt`, `ui/settings/SettingsScreen.kt`
- Create: `android/app/src/main/kotlin/io/celox/cue/ui/list/ListModel.kt` (reine Funktion)
- Test: `android/app/src/test/kotlin/io/celox/cue/ui/list/ListModelTest.kt`

**Interfaces:**
- Consumes: `PromptRepository`, `ConnectResult`, `SyncResult` (Task 7); `parseQuery`, `promptMatches`, `columnComparator`, `toView()` (Tasks 2, 4)
- Produces:
  - `data class Section(val status: Status, val prompts: List<PromptEntity>)`
  - `fun buildSections(prompts: List<PromptEntity>, projects: List<ProjectEntity>, query: String, pendingIds: Set<Long>): List<Section>` — Reihenfolge der Abschnitte `queued, running, done, failed, archived`, leere Abschnitte fallen weg, innerhalb nach `columnComparator`
  - Routen: `list`, `detail/{id}`, `edit/{id}` (id = `new` für Anlegen), `settings`

- [ ] **Step 1: Failing test für die Listenlogik**

```kotlin
package io.celox.cue.ui.list

import com.google.common.truth.Truth.assertThat
import io.celox.cue.core.Priority
import io.celox.cue.core.Status
import io.celox.cue.data.db.ProjectEntity
import io.celox.cue.data.db.PromptEntity
import org.junit.Test

class ListModelTest {
    private fun p(id: Long, status: Status, title: String = "t$id", projectId: Long? = null, sort: Int = id.toInt(), prio: Priority = Priority.normal) =
        PromptEntity(id, title, "", projectId, status, sort, "", false, prio, false, false, false, "")

    @Test fun `sections follow the board order and drop empty ones`() {
        val s = buildSections(listOf(p(1, Status.done), p(2, Status.queued)), emptyList(), "", emptySet())
        assertThat(s.map { it.status }).containsExactly(Status.queued, Status.done).inOrder()
    }

    @Test fun `inside a section the shared column order applies`() {
        val s = buildSections(listOf(p(1, Status.queued), p(2, Status.queued, prio = Priority.high)), emptyList(), "", emptySet())
        assertThat(s.single().prompts.map { it.id }).containsExactly(2L, 1L).inOrder()
    }

    @Test fun `the search sees project names`() {
        val projects = listOf(ProjectEntity(9, "termstats", "", 0))
        val s = buildSections(listOf(p(1, Status.queued, projectId = 9), p(2, Status.queued)), projects, "\"term", emptySet())
        assertThat(s.single().prompts.map { it.id }).containsExactly(1L)
    }

    @Test fun `an offline-created prompt shows at the top of the queue`() {
        // sortOrder Int.MIN_VALUE (SyncEngine.applyLocally) — ein neuer Prompt soll
        // nicht unten in einer Queue von hunderten verschwinden.
        val s = buildSections(listOf(p(1, Status.queued), p(-1, Status.queued, sort = Int.MIN_VALUE)), emptyList(), "", setOf(-1))
        assertThat(s.single().prompts.first().id).isEqualTo(-1L)
    }
}
```

Run → rot.

- [ ] **Step 2: `ListModel.kt`**

```kotlin
package io.celox.cue.ui.list

import io.celox.cue.core.Status
import io.celox.cue.core.columnComparator
import io.celox.cue.core.parseQuery
import io.celox.cue.core.promptMatches
import io.celox.cue.data.db.ProjectEntity
import io.celox.cue.data.db.PromptEntity
import io.celox.cue.data.db.toView

data class Section(val status: Status, val prompts: List<PromptEntity>)

private val ORDER = listOf(Status.queued, Status.running, Status.done, Status.failed, Status.archived)

fun buildSections(
    prompts: List<PromptEntity>,
    projects: List<ProjectEntity>,
    query: String,
    @Suppress("UNUSED_PARAMETER") pendingIds: Set<Long>,
): List<Section> {
    val parsed = parseQuery(query)
    val names = projects.associate { it.id to it.name }
    val hits = prompts.filter { promptMatches(it.toView(), it.projectId?.let(names::get).orEmpty(), parsed) }
    val cmp = compareBy<PromptEntity, io.celox.cue.core.PromptView>(columnComparator) { it.toView() }
    return ORDER.mapNotNull { status ->
        hits.filter { it.status == status }.sortedWith(cmp).takeIf { it.isNotEmpty() }?.let { Section(status, it) }
    }
}
```

(`pendingIds` bleibt im Vertrag, damit die Liste später wartende Änderungen markieren kann; die Oberfläche in Step 4 nutzt dafür direkt `repository.pending`. Wenn der Implementierer das Argument nicht braucht, streicht er es samt Test-Argument — kein totes Parameter-Relikt.)

Run → PASS. Commit: `git commit -am "feat(android): Listenmodell — Suche und Reihenfolge wie im Web"` (neue Dateien vorher `git add`).

- [ ] **Step 3: Theme**

`ui/theme/Theme.kt` — Hausfarbe aus `frontend/public/favicon.svg` (Lavendel `#a78bfa`), dynamische Farben ab Android 12:

```kotlin
package io.celox.cue.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

private val Lavender = Color(0xFFA78BFA)

@Composable
fun CueTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val ctx = LocalContext.current
    val scheme = when {
        Build.VERSION.SDK_INT >= 31 -> if (dark) dynamicDarkColorScheme(ctx) else dynamicLightColorScheme(ctx)
        dark -> darkColorScheme(primary = Lavender)
        else -> lightColorScheme(primary = Color(0xFF6D4FD1))
    }
    MaterialExpressiveTheme(colorScheme = scheme, content = content)
}
```

(`MaterialExpressiveTheme` ist in material3 1.5.0-alpha verfügbar — so nutzt es auch flipper; bei Kompilierfehler dort in `ui/theme/` nachsehen, wie der Aufruf lautet.)

- [ ] **Step 4: ViewModels und Bildschirme**

`ListViewModel`:

```kotlin
package io.celox.cue.ui.list

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.celox.cue.data.PromptRepository
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

@HiltViewModel
class ListViewModel @Inject constructor(private val repo: PromptRepository) : ViewModel() {
    val query = MutableStateFlow("")
    val sections = combine(repo.prompts, repo.projects, query, repo.pending) { p, pr, q, pend ->
        buildSections(p, pr, q, pend.map { it.promptId }.toSet())
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    val pending = repo.pending.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    val syncState = repo.syncState.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    val projects = repo.projects.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun refresh() = viewModelScope.launch { repo.syncNow() }
    suspend fun live() = repo.liveLoop()
}
```

`ListScreen` (Kernpunkte, als Compose):
- `Scaffold` mit `TopAppBar` („cue", Aktion Einstellungen), `SearchBar`/`OutlinedTextField` für `query` (Platzhalter: `Suchen · "projekt` für nur Projekte`), `FloatingActionButton` „Neu" → `edit/new`, Pull-to-Refresh (`PullToRefreshBox`) → `vm.refresh()`.
- `LazyColumn`: je `Section` ein Kopf (`Queued`/`Running`/`Done`/`Failed`/`Archived` + Anzahl), einklappbar (Zustand in `rememberSaveable`; `done`/`failed`/`archived` starten eingeklappt), darunter Zeilen: Titel (1 Zeile), Projektname + Tags (1 Zeile, gedimmt), Priorität `high` als `!`, eine offene lokale Änderung als kleines `cloud_upload`-Symbol, ein Fehler aus `lastError` als rotes `error`-Symbol mit dem Text im Detail.
- **Langes Drücken auf eine Zeile kopiert den Text** (der häufigste Griff, spec § 4) — `ClipboardManager.setText`, dazu eine Snackbar „Kopiert"; Tippen öffnet das Detail.
- Live-Poll: `LaunchedEffect(Unit) { lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { vm.live() } }` — läuft nur, solange die App sichtbar ist.
- Unter der Leiste eine Zeile „Offline — Änderungen werden später gesendet", wenn `pending` nicht leer und `syncState.lastSyncAt` älter als 60 s.

`DetailScreen(id)`: Titel, Projekt, Tags, Status; Text in `SelectionContainer` (Monospace, scrollbar); großer Knopf **„Kopieren"** (gefüllt, oben) und „Bearbeiten". Steht ein `lastError` zu diesem Prompt an, ein Hinweiskasten mit dem Text und der Erklärung „Der Server hat die Änderung abgelehnt; sie bleibt gespeichert."

`EditViewModel` + `EditScreen(id or new)`: Felder Titel, Text (mehrzeilig, groß), Projekt (Dropdown `ExposedDropdownMenuBox` mit „Kein Projekt"), Tags (Textfeld, komma-getrennt; darunter Vorschlags-Chips aus `repo.tags`, Top 12 nach Nutzung, Tippen hängt an), Status (nur beim Bearbeiten, Segmente queued/running/done), Priorität. Speichern:
- neu → `repo.create(title, body, projectId, tags)`; leerer Text → Fehlermeldung am Feld, kein Speichern (der Server verlangt `body`).
- bearbeiten → nur **geänderte** Felder in ein `JsonObject`; Projekt entfernt → `unassign_project: true`. Unverändert → nichts senden, einfach zurück.

`SettingsViewModel` + `SettingsScreen`:
- Nicht verbunden: Felder „Server" (Vorbelegung `https://cue.celox.io`) und „Geräte-Token" (Einfügen-Knopf liest die Zwischenablage), Knopf „Verbinden" → `repo.connect(...)`; Meldungen: `BadUrl` „Adresse ungültig (https:// nötig)", `Rejected` „Token abgelehnt — in cue unter Einstellungen → Geräte neu anlegen", `Offline` „Server nicht erreichbar".
- Verbunden: Server, letzter Abgleich (`lastSyncAt` relativ), Anzahl wartender Änderungen, Knopf „Jetzt abgleichen", Knopf **„Abmelden"** mit Bestätigungsdialog („Löscht die lokale Kopie. Nicht gesendete Änderungen gehen verloren." — die Anzahl nennen).
- Wurde das Gerät gesperrt (`SyncResult.Revoked` zuletzt gesehen, Token weg), zeigt die App beim Start die Einstellungen mit dem Hinweis **„Gerät gesperrt — lokale Kopie gelöscht."** (Zustand als Flag in `SharedPreferences` `cue-ui`, beim nächsten erfolgreichen `connect` zurückgesetzt).

`CueApp.kt`: `NavHost` mit den vier Routen; Startroute `settings`, wenn `!repo.isConfigured`, sonst `list`. `MainActivity`: `setContent { CueTheme { CueApp() } }`.

- [ ] **Step 5: Auf dem Emulator prüfen**

```bash
cd android && ./gradlew :app:installDebug
```

Gegen die Live-Instanz (Teil A ausgeliefert) — in der Web-App ein Gerät „Emulator" anlegen, Token kopieren. Durchspielen und **jeden Punkt beobachten, nicht annehmen**:
1. Verbinden mit falschem Token → „Token abgelehnt", nichts gespeichert.
2. Verbinden mit richtigem Token → Liste erscheint, gleiche Reihenfolge wie im Web-Board (drei Stichproben vergleichen).
3. Suche `"<projekt>` → nur dessen Prompts.
4. Lange drücken → Snackbar „Kopiert", Zwischenablage stimmt.
5. Flugmodus → Prompt anlegen, bearbeiten → Offline-Zeile erscheint → Flugmodus aus → im Web erscheint **ein** Prompt mit dem Endstand.
6. Im Web einen Prompt ändern → auf dem Emulator binnen ~2 s sichtbar (Live-Poll).
7. Im Web das Gerät sperren → App zeigt „Gerät gesperrt", Liste leer, `adb shell run-as io.celox.cue.debug ls databases` zeigt eine leere/neue DB.
8. Hell/Dunkel, Schriftgröße 200 % (`adb shell settings put system font_scale 2.0`) — nichts abgeschnitten.

- [ ] **Step 6: Commit**

```bash
git add android/app && git status --short   # kein Signier-Material
git commit -m "feat(android): Liste, Detail, Bearbeiten, Einstellungen"
```

---

### Task 9: Symbol, Signieren, Release

**Files:**
- Create: `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`, `ic_launcher_round.xml`, `android/app/src/main/res/drawable/ic_launcher_foreground.xml`, `android/app/src/main/res/values/ic_launcher_background.xml`
- Modify: `android/app/src/main/AndroidManifest.xml` (`android:icon`, `android:roundIcon`)
- Create: `.github/workflows/android-release.yml`
- Create: `android/README.md`
- Modify: `README.md`, `CLAUDE.md`, `CHANGELOG.md`

- [ ] **Step 1: Symbol aus dem Hauszeichen**

`frontend/public/favicon.svg` ist die Quelle (Kachel `#0d1117`, Lavendel `#a78bfa`, Zeilen + Blitz). Pfade aus der SVG in ein `VectorDrawable` übertragen (`ic_launcher_foreground.xml`, Viewport 108×108, Motiv in der inneren 72×72-Schutzzone), Hintergrund `#0D1117` in `ic_launcher_background.xml`. Adaptive-Icon-XML:

```xml
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
```

Da `minSdk` 24 < 26: zusätzlich PNG-Fallbacks `mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png` (48/72/96/144/192 px) aus der SVG rendern — mit **Chrome headless**, nicht ImageMagick (Haus-Regel: IM rendert Verläufe schwarz). Auf dem Emulator ansehen: Startbildschirm, runde und eckige Maske, Themed Icon (Android 13).

- [ ] **Step 2: Keystore nach Runbook**

`~/My Drive/dev/keystore/CLAUDE.md` Abschnitte 0–4 mit `APP=cue`, `PACKAGE=io.celox.cue`, `REPO=pepperonas/cue`, `PROJECT=/Users/martin/claude/cue/android`, `KSDIR=~/My Drive/dev/keystore/cue-keystore`. Danach:

```bash
cd /Users/martin/claude/cue
git status --short --ignored android | grep -E 'jks|keystore.properties'   # muss als IGNORIERT (!!) erscheinen
git ls-files | grep -E '\.jks$|keystore\.properties$'                     # muss LEER sein
(cd backend && uv run pytest tests/test_no_secrets_in_repo.py -q)         # grün
```

Das private Repo `pepperonas/keystore` bekommt `cue-keystore/` per Commit (Runbook Abschnitt 6 ff.). GitHub-Secrets für `pepperonas/cue`: `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` (Runbook-Befehle mit `gh secret set`).

- [ ] **Step 3: Release-Workflow**

`.github/workflows/android-release.yml`:

```yaml
name: android-release
on:
  push:
    tags: ["android-v*"]
permissions:
  contents: write
jobs:
  build:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: android
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: "21" }
      - uses: android-actions/setup-android@v3
      - name: Keystore
        run: echo "${{ secrets.KEYSTORE_BASE64 }}" | base64 -d > release.jks
      - name: Tests
        run: ./gradlew :app:testDebugUnitTest
      - name: Build
        env:
          KEYSTORE_FILE: release.jks
          KEYSTORE_PASSWORD: ${{ secrets.KEYSTORE_PASSWORD }}
          KEY_ALIAS: ${{ secrets.KEY_ALIAS }}
          KEY_PASSWORD: ${{ secrets.KEY_PASSWORD }}
        run: ./gradlew :app:assembleRelease
      - name: Signatur pruefen
        run: |
          APK=app/build/outputs/apk/release/app-release.apk
          "$ANDROID_HOME/build-tools/35.0.0/apksigner" verify --print-certs "$APK"
          cp "$APK" "cue-${GITHUB_REF_NAME#android-v}.apk"
      - name: Release
        env: { GH_TOKEN: "${{ github.token }}" }
        run: gh release create "$GITHUB_REF_NAME" "cue-${GITHUB_REF_NAME#android-v}.apk" --title "cue für Android ${GITHUB_REF_NAME#android-v}" --notes "Siehe CHANGELOG.md."
```

⚠️ Der Contract-Test aus Task 2 liest `../../contracts/column-order.json` — im Workflow liegt das Repo vollständig vor, der Pfad stimmt.

- [ ] **Step 4: Lokal signiert bauen und prüfen**

```bash
cd android && ./gradlew :app:assembleRelease
$ANDROID_HOME/build-tools/35.0.0/apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
```

Expected: `Verified using v2 scheme … true`, Zertifikat `CN=Martin Pfeffer, O=celox.io, L=Munich, C=DE`, SHA-256 gleich dem in `secrets.txt`. APK aufs Gerät/den Emulator (`adb install`), Task-8-Durchgang Punkte 2, 4, 5 wiederholen — ein R8-Build kann Serialisierung brechen, die im Debug-Build lief.

- [ ] **Step 5: Doku**

`android/README.md` (deutsch): was die App kann und bewusst nicht, Einrichtung (Gerät in cue anlegen → Token einfügen), Bauen (JDK 21, `ANDROID_HOME`), Tests, Release per Tag, die Fehlerfälle-Tabelle aus spec § 6. `README.md` der Wurzel: kurzer Abschnitt „Android" mit Link. `CLAUDE.md`: Eintrag „Android-App (`android/`)" mit den tragenden Regeln (nur `/api/app`, 401/403 = löschen vs. Netzfehler = warten, ein Warteschlangen-Eintrag je Prompt, lokale IDs negativ + im sync_state gezählt, Cursor erst nach erfolgreichem Holen, `allowBackup=false`, Spaltenreihenfolge am gemeinsamen Vertrag, Release per `android-v*`-Tag). `CHANGELOG.md`: Eintrag unter `[Unreleased]` → „Android-App 0.1.0" (die Server-Version ändert sich dadurch nicht; `test_docs.py` prüft nur die Server-Version).

- [ ] **Step 6: Commit, Tag, Release**

```bash
cd /Users/martin/claude/cue
git status --short                  # KEIN Signier-Material, kein *.apk
git add -A && git commit -m "feat(android): Symbol, Signieren, Release-Workflow (android 0.1.0)"
git push
git tag android-v0.1.0 && git push origin android-v0.1.0
gh run watch --exit-status
gh release view android-v0.1.0
```

APK aus dem Release herunterladen, `apksigner verify` darauf, installieren (über die vorher installierte **Debug**-App hinweg geht das nicht — anderes Paket `.debug`, beide stehen nebeneinander; das ist gewollt).
