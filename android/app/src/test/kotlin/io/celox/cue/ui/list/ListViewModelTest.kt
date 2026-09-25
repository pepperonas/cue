package io.celox.cue.ui.list

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.testing.WorkManagerTestInitHelper
import com.google.common.truth.Truth.assertThat
import io.celox.cue.core.Status
import io.celox.cue.data.PromptRepository
import io.celox.cue.data.RevokedNotice
import io.celox.cue.data.auth.TokenStore
import io.celox.cue.data.db.CueDatabase
import io.celox.cue.data.net.ApiResult
import io.celox.cue.data.net.AppApi
import io.celox.cue.data.net.ChangeFeedDto
import io.celox.cue.data.net.ProjectDto
import io.celox.cue.data.net.PromptDto
import io.celox.cue.data.net.TagListDto
import io.celox.cue.data.sync.SyncEngine
import io.celox.cue.ui.AppNavTarget
import io.celox.cue.ui.AppNavigator
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.JsonObject
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Regel D: eine erkannte Sperre (`SyncResult.Revoked`) muss SOFORT beide Wege
 * bekommen — das persistierte Flag ([RevokedNotice], überlebt einen
 * Kaltstart) UND das Live-Signal ([AppNavigator], holt die laufende Sitzung
 * ohne Neustart ab, Verifikationspunkt 7).
 *
 * `refresh()` selbst ist ABSICHTLICH kein `suspend` (Brief-Vertrag,
 * feuert-und-vergisst über `viewModelScope`) — die eigentliche Netzwerk-
 * Arbeit läuft NACH einem `withContext(Dispatchers.IO)`, einem echten
 * Dispatcher-Sprung, den `viewModelScope`s eigener `SupervisorJob` nicht an
 * die Test-Coroutine zurückmeldet. Statt zu raten, wie lange das dauert,
 * wartet jeder Test auf ein ECHTES beobachtbares Ereignis (`navigator.events`
 * bzw. `repo.syncState`) als gewöhnlichen `suspend`-Aufruf in der eigenen
 * Test-Coroutine — dieselbe Lehre wie in `EditViewModelTest`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = android.app.Application::class)
class ListViewModelTest {
    private val testDispatcher = UnconfinedTestDispatcher()

    private lateinit var db: CueDatabase
    private lateinit var api: FakeApi
    private lateinit var store: FakeStore
    private lateinit var context: Context
    private lateinit var repo: PromptRepository
    private lateinit var revokedNotice: RevokedNotice
    private lateinit var navigator: AppNavigator

    class FakeStore(token: String? = "tok", url: String = "https://cue.celox.io") : TokenStore {
        override var token: String? = token
        private var urlField: String = url
        override val serverUrl: String get() = urlField
        override fun save(url: String, token: String) { urlField = url; this.token = token }
        override fun clear() { token = null }
        override fun setServerUrl(url: String) { urlField = url }
    }

    /** `forced` lässt jeden Aufruf mit diesem Code antworten — für die 401/403-Sperre. */
    class FakeApi : AppApi {
        var forced: Int? = null
        private fun <T> guard(ok: () -> ApiResult<T>): ApiResult<T> = forced?.let { ApiResult.Http(it, "") } ?: ok()

        override suspend fun prompts() = guard { ApiResult.Ok(emptyList<PromptDto>()) }
        override suspend fun projects() = guard { ApiResult.Ok(emptyList<ProjectDto>()) }
        override suspend fun tags() = guard { ApiResult.Ok(TagListDto(emptyList())) }
        override suspend fun changes(since: String?, waitSeconds: Int) = guard { ApiResult.Ok(ChangeFeedDto("c1")) }
        override suspend fun create(fields: JsonObject) = guard {
            ApiResult.Ok(PromptDto(id = 1, title = "", body = "", status = Status.queued, sortOrder = 0, updatedAt = ""))
        }
        override suspend fun patch(id: Long, fields: JsonObject) = guard {
            ApiResult.Ok(PromptDto(id = id, title = "", body = "", status = Status.queued, sortOrder = 0, updatedAt = ""))
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
        revokedNotice = RevokedNotice(context)
        navigator = AppNavigator()
    }

    @After fun tearDown() {
        db.close()
        Dispatchers.resetMain()
    }

    @Test fun `a revoked refresh marks the notice and wakes the navigator`() = runTest(testDispatcher) {
        assertThat(revokedNotice.isSet()).isFalse()
        api.forced = 401

        val vm = ListViewModel(repo, revokedNotice, navigator)
        vm.refresh()

        assertThat(navigator.events.first()).isEqualTo(AppNavTarget.DEVICE_REVOKED)
        assertThat(revokedNotice.isSet()).isTrue()
    }

    @Test fun `a successful refresh never marks the notice`() = runTest(testDispatcher) {
        val vm = ListViewModel(repo, revokedNotice, navigator)
        vm.refresh()

        repo.syncState.first { it?.lastSyncAt != null } // wartet auf den ECHTEN Abschluss von syncNow()

        assertThat(revokedNotice.isSet()).isFalse()
    }

    @Test fun `an already-set notice is cleared only by a successful connect, never by refresh`() = runTest(testDispatcher) {
        revokedNotice.mark()
        val vm = ListViewModel(repo, revokedNotice, navigator)
        vm.refresh() // erfolgreich — Regel D nennt nur „nächstes ERFOLGREICHES connect()" als Löschweg

        repo.syncState.first { it?.lastSyncAt != null }

        assertThat(revokedNotice.isSet()).isTrue()
    }
}
