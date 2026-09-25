package io.celox.cue.ui.edit

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
import io.celox.cue.data.auth.TokenStore
import io.celox.cue.data.db.CueDatabase
import io.celox.cue.data.db.ProjectEntity
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
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Regel C: `create`/`update` liefern `null`/`false`, wenn `PromptRepository`
 * die Änderung ohne Token verweigert — `EditViewModel.save()` muss das als
 * eigenen [SaveResult] weiterreichen, statt „gespeichert" zu behaupten.
 *
 * Regel F: nur GEÄNDERTE Felder gehen in das PATCH; ein entferntes Projekt
 * wird zu `unassign_project`, nicht zu einem `project_id:null`.
 *
 * Das ladende `collect` in `EditViewModel.init {}` läuft in `viewModelScope`
 * (eigener `SupervisorJob`, KEIN Kind der Test-Coroutine) und Rooms
 * Flow-Abfragen laufen über einen ECHTEN Hintergrund-Executor — ein
 * `advanceUntilIdle()` auf `runTest`s eigenem Scheduler erreicht das NICHT
 * (live beobachtet: `vm.loaded.value` blieb dabei `false`; ein Versuch, Room
 * per `setQueryExecutor { it.run() }` synchron zu zwingen, kollidierte
 * stattdessen mit dessen eigener Transaktions-/Invalidation-Prüfung).
 * Stattdessen wird direkt auf das ECHTE Ereignis gewartet — `vm.loaded.first
 * { it }` als gewöhnlicher `suspend`-Aufruf IN der Test-Coroutine selbst
 * (nicht in einer separaten `launch{}`) —, das `runTest` unabhängig vom
 * Dispatcher korrekt abwartet, weil es eine echte Suspension ist, keine
 * virtuelle Verzögerung.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = android.app.Application::class)
class EditViewModelTest {
    private val testDispatcher = UnconfinedTestDispatcher()

    private lateinit var db: CueDatabase
    private lateinit var api: FakeApi
    private lateinit var store: FakeStore
    private lateinit var context: Context
    private lateinit var repo: PromptRepository

    class FakeStore(token: String? = "tok", url: String = "https://cue.celox.io") : TokenStore {
        override var token: String? = token
        private var urlField: String = url
        override val serverUrl: String get() = urlField
        override fun save(url: String, token: String) { urlField = url; this.token = token }
        override fun clear() { token = null }
        override fun setServerUrl(url: String) { urlField = url }
    }

    /** Ein Server im Speicher; hält jedes PATCH-Feld fest, damit Regel F direkt geprüft werden kann. */
    class FakeApi : AppApi {
        val rows = linkedMapOf<Long, PromptDto>()
        var lastPatchFields: JsonObject? = null
        var lastCreateFields: JsonObject? = null

        override suspend fun prompts() = ApiResult.Ok(rows.values.toList())
        override suspend fun projects() = ApiResult.Ok(emptyList<ProjectDto>())
        override suspend fun tags() = ApiResult.Ok(TagListDto(emptyList()))
        override suspend fun changes(since: String?, waitSeconds: Int) = ApiResult.Ok(ChangeFeedDto("c1"))

        override suspend fun create(fields: JsonObject): ApiResult<PromptDto> {
            lastCreateFields = fields
            val dto = PromptDto(
                id = 100L,
                title = fields["title"]?.jsonPrimitive?.content.orEmpty(),
                body = fields["body"]?.jsonPrimitive?.content.orEmpty(),
                status = Status.queued, sortOrder = 0, priority = Priority.normal,
                updatedAt = "2026-09-25T10:00:00Z",
            )
            rows[dto.id] = dto
            return ApiResult.Ok(dto)
        }

        override suspend fun patch(id: Long, fields: JsonObject): ApiResult<PromptDto> {
            lastPatchFields = fields
            val old = rows[id] ?: PromptDto(
                id = id, title = "x", body = "b", status = Status.queued, sortOrder = 0,
                priority = Priority.normal, updatedAt = "2026-09-25T10:00:00Z",
            )
            val dto = old.copy(title = fields["title"]?.jsonPrimitive?.content ?: old.title)
            rows[id] = dto
            return ApiResult.Ok(dto)
        }
    }

    @Before fun setUp() {
        Dispatchers.setMain(testDispatcher)
        context = ApplicationProvider.getApplicationContext()
        db = Room.inMemoryDatabaseBuilder(context, CueDatabase::class.java).allowMainThreadQueries().build()
        api = FakeApi()
        store = FakeStore()
        val engine = SyncEngine(db, api, store)
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

    private fun prompt(id: Long, title: String = "Titel", tags: String = "a, b", projectId: Long? = null) =
        PromptEntity(
            id = id, title = title, body = "Text", projectId = projectId, status = Status.queued, sortOrder = 0,
            tags = tags, bookmarked = false, priority = Priority.normal, blocked = false, tested = false,
            testClosely = false, updatedAt = "2026-09-24T10:00:00Z",
        )

    // ---- Regel C ----

    @Test fun `saving a new prompt without a token reports NotConnected, not Saved`() = runTest(testDispatcher) {
        store.token = null
        val vm = EditViewModel(repo, SavedStateHandle(mapOf("id" to "new")))
        vm.body = "Etwas Text"

        val result = vm.save()

        assertThat(result).isEqualTo(SaveResult.NotConnected)
        assertThat(db.promptDao().ids()).isEmpty() // nichts geschrieben
    }

    @Test fun `saving an edit without a token reports NotConnected, not Saved`() = runTest(testDispatcher) {
        db.promptDao().upsert(listOf(prompt(1)))
        val vm = EditViewModel(repo, SavedStateHandle(mapOf("id" to "1")))
        vm.loaded.first { it }

        store.token = null // zwischen Laden und Speichern getrennt
        vm.title = "Geändert"

        val result = vm.save()

        assertThat(result).isEqualTo(SaveResult.NotConnected)
    }

    // ---- Regel F ----

    @Test fun `only the changed field travels in the PATCH`() = runTest(testDispatcher) {
        db.promptDao().upsert(listOf(prompt(1, title = "Alt", tags = "a, b")))
        val vm = EditViewModel(repo, SavedStateHandle(mapOf("id" to "1")))
        vm.loaded.first { it }
        assertThat(vm.title).isEqualTo("Alt")
        assertThat(vm.tagsText).isEqualTo("a, b")

        vm.title = "Neu" // Tags/Text/Status/Priorität unverändert lassen

        val result = vm.save()
        // `save()` selbst schiebt nur lokal in die Warteschlange + stößt den
        // Worker an — der WIRD unter dem Test nicht ausgeführt; erst dieser
        // direkte Abgleich schickt es wirklich an den (Fake-)Server.
        repo.syncNow()

        assertThat(result).isEqualTo(SaveResult.Saved)
        val fields = api.lastPatchFields!!
        assertThat(fields.keys).containsExactly("title")
        assertThat(fields["title"]!!.jsonPrimitive.content).isEqualTo("Neu")
    }

    @Test fun `removing the project sends unassign_project, never a null project_id`() = runTest(testDispatcher) {
        db.promptDao().upsert(listOf(prompt(1, projectId = 9)))
        val vm = EditViewModel(repo, SavedStateHandle(mapOf("id" to "1")))
        vm.loaded.first { it }
        assertThat(vm.projectId).isEqualTo(9L)

        vm.projectId = null

        vm.save()
        repo.syncNow()

        val fields = api.lastPatchFields!!
        assertThat(fields.keys).containsExactly("unassign_project")
        assertThat(fields["unassign_project"]!!.jsonPrimitive.content).isEqualTo("true")
    }

    @Test fun `saving with nothing changed is a no-op and never reaches the network`() = runTest(testDispatcher) {
        db.promptDao().upsert(listOf(prompt(1)))
        val vm = EditViewModel(repo, SavedStateHandle(mapOf("id" to "1")))
        vm.loaded.first { it }

        val result = vm.save()

        assertThat(result).isEqualTo(SaveResult.NoOp)
        assertThat(api.lastPatchFields).isNull()
    }

    @Test fun `an empty body is refused before anything is sent`() = runTest(testDispatcher) {
        val vm = EditViewModel(repo, SavedStateHandle(mapOf("id" to "new")))
        vm.body = "   "

        val result = vm.save()

        assertThat(result).isEqualTo(SaveResult.BodyRequired)
        assertThat(vm.bodyError).isNotNull()
        assertThat(api.lastCreateFields).isNull()
    }
}
