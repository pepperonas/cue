package io.celox.cue.ui.detail

import android.content.Context
import androidx.lifecycle.SavedStateHandle
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.testing.WorkManagerTestInitHelper
import com.google.common.truth.Truth.assertThat
import io.celox.cue.core.Priority
import io.celox.cue.core.Status
import io.celox.cue.data.PromptRepository
import io.celox.cue.data.RevokedNotice
import io.celox.cue.data.auth.TokenStore
import io.celox.cue.data.db.CueDatabase
import io.celox.cue.data.db.PromptEntity
import io.celox.cue.data.net.ApiResult
import io.celox.cue.data.net.AppApi
import io.celox.cue.data.net.ChangeFeedDto
import io.celox.cue.data.net.ProjectDto
import io.celox.cue.data.net.PromptDto
import io.celox.cue.data.net.TagListDto
import io.celox.cue.data.sync.SyncEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.JsonObject
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Regression: `CueApp` deklariert die Route "detail/{id}" mit `NavType.LongType`
 * — im `SavedStateHandle` steht dort ein echter `Long`. `savedStateHandle.get<String>("id")`
 * warf live eine `ClassCastException` bei JEDEM Antippen einer Zeile (Verifikationspunkt 2).
 * `EditViewModel` liest an derselben Stelle bewusst einen `String` ("edit/{id}" ist
 * `NavType.StringType`, wegen `Routes.NEW_ID`="new") — beide Typen sind also richtig,
 * nur an unterschiedlichen Routen.
 *
 * Fix-Runde 1 (Task 8): `Dispatchers.setMain(UnconfinedTestDispatcher())` musste dazukommen,
 * sobald ein Test `vm.loaded`/`vm.prompt` tatsächlich ABWARTET (Regeln 8+11) — `viewModelScope`
 * hängt an `Dispatchers.Main`, und ohne ein gesetztes Main scheiterte `runTest` mit
 * `UncompletedCoroutinesError` (dieselbe Lehre wie in `EditViewModelTest`/`ListViewModelTest`).
 * Der ursprüngliche, rein synchrone Test (`reads the id as the Long…`) brauchte das nie, weil er
 * nie auf die Coroutine wartet — lief also live GRÜN, ohne dass diese Lücke auffiel.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = android.app.Application::class)
class DetailViewModelTest {
    private val testDispatcher = UnconfinedTestDispatcher()

    private lateinit var db: CueDatabase
    private lateinit var repo: PromptRepository

    class FakeStore(token: String? = "tok", url: String = "https://cue.celox.io") : TokenStore {
        override var token: String? = token
        private var urlField: String = url
        override val serverUrl: String get() = urlField
        override fun save(url: String, token: String) { urlField = url; this.token = token }
        override fun clear() { token = null }
        override fun setServerUrl(url: String) { urlField = url }
    }

    class FakeApi : AppApi {
        override suspend fun prompts() = ApiResult.Ok(emptyList<PromptDto>())
        override suspend fun projects() = ApiResult.Ok(emptyList<ProjectDto>())
        override suspend fun tags() = ApiResult.Ok(TagListDto(emptyList()))
        override suspend fun changes(since: String?, waitSeconds: Int) = ApiResult.Ok(ChangeFeedDto("c1"))
        override suspend fun create(fields: JsonObject) = throw NotImplementedError()
        override suspend fun patch(id: Long, fields: JsonObject) = throw NotImplementedError()
    }

    @Before fun setUp() {
        Dispatchers.setMain(testDispatcher)
        val context: Context = ApplicationProvider.getApplicationContext()
        db = Room.inMemoryDatabaseBuilder(context, CueDatabase::class.java).allowMainThreadQueries().build()
        val api = FakeApi()
        val store = FakeStore()
        val engine = SyncEngine(db, api, store, RevokedNotice(context))
        WorkManagerTestInitHelper.initializeTestWorkManager(
            context,
            Configuration.Builder().setMinimumLoggingLevel(android.util.Log.DEBUG).build(),
        )
        repo = PromptRepository(db, engine, api, store, context)
    }

    @After fun tearDown() {
        db.close()
        Dispatchers.resetMain()
    }

    @Test fun `reads the id as the Long the LongType route argument really is`() = runTest(testDispatcher) {
        db.promptDao().upsert(
            listOf(
                PromptEntity(
                    id = 7, title = "T", body = "B", projectId = null, status = Status.queued, sortOrder = 0,
                    tags = "", bookmarked = false, priority = Priority.normal, blocked = false, tested = false,
                    testClosely = false, updatedAt = "",
                ),
            ),
        )

        // So, wie NavHost es tatsächlich befüllt — ein Long, kein String.
        val vm = DetailViewModel(repo, SavedStateHandle(mapOf("id" to 7L)))

        assertThat(vm.promptId).isEqualTo(7L)
    }

    /**
     * Fix-Runde 1 (Task 8), Regel 11: eine negative ID ist kein Sonderfall — ein offline
     * angelegter, noch nicht geschobener Prompt trägt genau so eine (`SyncEngine.applyLocally`,
     * `sortOrder = Int.MIN_VALUE`). Öffnet man ihn (z. B. aus der Liste), muss `DetailViewModel`
     * ihn genauso finden wie eine echte Server-ID.
     */
    @Test fun `a negative, offline-created id resolves the same as a real server id`() = runTest(testDispatcher) {
        db.promptDao().upsert(
            listOf(
                PromptEntity(
                    id = -3, title = "Offline angelegt", body = "B", projectId = null, status = Status.queued,
                    sortOrder = Int.MIN_VALUE, tags = "", bookmarked = false, priority = Priority.normal,
                    blocked = false, tested = false, testClosely = false, updatedAt = "",
                ),
            ),
        )

        val vm = DetailViewModel(repo, SavedStateHandle(mapOf("id" to -3L)))

        assertThat(vm.promptId).isEqualTo(-3L)
        vm.loaded.first { it }
        assertThat(vm.prompt.value?.title).isEqualTo("Offline angelegt")
    }

    /**
     * Fix-Runde 1 (Task 8), Regel 8: `loaded` wird auch für eine WIRKLICH fehlende Zeile wahr —
     * ein `null` in `prompt` heißt erst dann „nicht gefunden", nicht schon vor der ersten Antwort.
     *
     * Fix-Runde 1 (Nacharbeit): `SharingStarted.Eagerly` (s. `DetailViewModel.prompt`) + der
     * `UnconfinedTestDispatcher` lassen den Room-Collect hier SOFORT beim Anlegen des ViewModels
     * bis zu seiner ersten Emission durchlaufen — anders als in der echten App (dort liegt
     * zwischen Konstruktion und erster Antwort eine echte Festplatten-Rundreise) gibt es unter
     * Robolectrics In-Memory-Room + Unconfined keine beobachtbare Lücke mehr, in der `loaded`
     * noch `false` wäre; ein `assertThat(vm.loaded.value).isFalse()` direkt nach der Konstruktion
     * bestand deshalb nicht mehr zuverlässig (in der ersten Fassung sogar nie mehr — die
     * Kollektion war zu diesem Zeitpunkt bereits durchgelaufen). Geprüft wird darum nur die
     * ZUSICHERUNG, die die Oberfläche tatsächlich braucht: `loaded` wird `true`, UND danach ist
     * `prompt` bestätigt `null` — nicht die genaue Zwischenlage, die dieser Testaufbau nicht mehr
     * beobachten kann.
     */
    @Test fun `loaded becomes true even for a truly missing id, distinct from still-loading`() = runTest(testDispatcher) {
        val vm = DetailViewModel(repo, SavedStateHandle(mapOf("id" to 999L)))

        vm.loaded.first { it }
        assertThat(vm.prompt.value).isNull() // bestätigt: es gibt diese Zeile nicht — kein Ladezustand mehr
    }
    /**
     * Regel 8, der Übergang selbst: mit einem `StandardTestDispatcher` läuft die Eagerly-Kollektion
     * erst, wenn der Dispatcher Arbeit ausführt — direkt nach der Konstruktion ist `loaded` also
     * deterministisch `false`. Ohne diesen Pin könnte `_loaded` mit `true` starten (der alte
     * „Nicht gefunden."-Blitz), und keiner der anderen Tests würde rot.
     */
    @Test fun `loaded starts false and turns true once Room has answered`() {
        val standard = StandardTestDispatcher()
        Dispatchers.setMain(standard)
        runTest(standard) {
            val vm = DetailViewModel(repo, SavedStateHandle(mapOf("id" to 999L)))

            assertThat(vm.loaded.value).isFalse()
            vm.loaded.first { it }
            assertThat(vm.prompt.value).isNull()
        }
    }

    /** I1: die Detailansicht einer offline angelegten Zeile überlebt deren Umschlüsseln. */
    @Test fun `the detail of an offline prompt follows it to its server id`() = runTest(testDispatcher) {
        val offline = PromptEntity(
            id = -3, title = "Offline angelegt", body = "B", projectId = null, status = Status.queued,
            sortOrder = Int.MIN_VALUE, tags = "", bookmarked = false, priority = Priority.normal,
            blocked = false, tested = false, testClosely = false, updatedAt = "",
        )
        db.promptDao().upsert(listOf(offline))
        val vm = DetailViewModel(repo, SavedStateHandle(mapOf("id" to -3L)))
        vm.loaded.first { it }

        db.adoptServerId(-3, offline.copy(id = 42))

        val seen = withContext(Dispatchers.Default) { withTimeout(5_000) { vm.prompt.first { it?.id == 42L } } }
        assertThat(seen!!.title).isEqualTo("Offline angelegt")
    }
}
