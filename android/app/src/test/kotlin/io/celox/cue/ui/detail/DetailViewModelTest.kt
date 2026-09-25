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
import kotlinx.coroutines.test.runTest
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
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = android.app.Application::class)
class DetailViewModelTest {
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
        val context: Context = ApplicationProvider.getApplicationContext()
        db = Room.inMemoryDatabaseBuilder(context, CueDatabase::class.java).allowMainThreadQueries().build()
        val api = FakeApi()
        val store = FakeStore()
        val engine = SyncEngine(db, api, store)
        WorkManagerTestInitHelper.initializeTestWorkManager(
            context,
            Configuration.Builder().setMinimumLoggingLevel(android.util.Log.DEBUG).build(),
        )
        repo = PromptRepository(db, engine, api, store, context)
    }

    @After fun tearDown() = db.close()

    @Test fun `reads the id as the Long the LongType route argument really is`() = runTest {
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
}
