package io.celox.cue.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.WorkManager
import androidx.work.testing.WorkManagerTestInitHelper
import com.google.common.truth.Truth.assertThat
import io.celox.cue.core.OpKind
import io.celox.cue.core.Priority
import io.celox.cue.core.Status
import io.celox.cue.data.auth.TokenStore
import io.celox.cue.data.db.CueDatabase
import io.celox.cue.data.db.PendingOpEntity
import io.celox.cue.data.db.PromptEntity
import io.celox.cue.data.net.ApiResult
import io.celox.cue.data.net.AppApi
import io.celox.cue.data.net.ChangeFeedDto
import io.celox.cue.data.net.ProjectDto
import io.celox.cue.data.net.PromptDto
import io.celox.cue.data.net.TagListDto
import io.celox.cue.data.sync.SyncEngine
import java.io.IOException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.currentTime
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
import org.robolectric.annotation.Config

/**
 * Deckt Regel A (Rückgabewerte + Worker-Anstoß nur bei angenommener
 * Änderung), Regel B (Löschen bei Server-/Kontowechsel — der Auftrag
 * verlangt hierfür ausdrücklich einen eigenen JVM-Test, den der Plan nicht
 * vorsah) und Regel C (`liveLoop` dreht ohne Token nicht heiß) ab.
 *
 * `application = android.app.Application::class`: die echte `CueApplication`
 * initialisiert WorkManager selbst (`Configuration.Provider`) und würde mit
 * `WorkManagerTestInitHelper` kollidieren — dieselbe Lösung wie im
 * Referenzprojekt (`DownloadRepositoryImplTest`).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = android.app.Application::class)
class PromptRepositoryTest {
    private lateinit var db: CueDatabase
    private lateinit var api: FakeApi
    private lateinit var store: FakeStore
    private lateinit var engine: SyncEngine
    private lateinit var workManager: WorkManager
    private lateinit var context: Context
    private lateinit var repo: PromptRepository

    /** Unique-Work-Name aus `SyncWorker` — dort bewusst `private`, hier als Literal gespiegelt. */
    private val kickTag = "cue-sync-now"

    class FakeStore(token: String? = "tok", url: String = "https://cue.celox.io") : TokenStore {
        override var token: String? = token
        override var serverUrl: String = url
        override fun save(url: String, token: String) { serverUrl = url; this.token = token }
        override fun clear() { token = null }
    }

    /** Ein Server im Speicher; `down`/`forced` erzwingen einen Ausgang, `calls` hält jeden Versuch fest. */
    class FakeApi : AppApi {
        var down = false
        var forced: Int? = null
        val rows = linkedMapOf<Long, PromptDto>()
        val calls = mutableListOf<String>()

        private fun <T> guard(block: () -> ApiResult<T>): ApiResult<T> {
            if (down) return ApiResult.Network(IOException("offline"))
            forced?.let { return ApiResult.Http(it, "") }
            return block()
        }

        override suspend fun prompts() = guard { ApiResult.Ok(rows.values.toList()) }
        override suspend fun projects() = guard { ApiResult.Ok(emptyList<ProjectDto>()) }
        override suspend fun tags() = guard { ApiResult.Ok(TagListDto(emptyList())) }
        override suspend fun changes(since: String?, waitSeconds: Int) = guard { ApiResult.Ok(ChangeFeedDto("c1")) }

        override suspend fun create(fields: JsonObject): ApiResult<PromptDto> {
            calls += "create"
            return guard {
                val dto = PromptDto(
                    id = 100L,
                    title = fields["title"]?.jsonPrimitive?.content.orEmpty(),
                    body = fields["body"]?.jsonPrimitive?.content.orEmpty(),
                    status = Status.queued, sortOrder = 0, priority = Priority.normal,
                    updatedAt = "2026-09-25T10:00:00Z",
                )
                rows[dto.id] = dto
                ApiResult.Ok(dto)
            }
        }

        override suspend fun patch(id: Long, fields: JsonObject): ApiResult<PromptDto> {
            calls += "patch:$id"
            return guard {
                val old = rows[id] ?: PromptDto(
                    id = id, title = "x", body = "b", status = Status.queued, sortOrder = 0,
                    priority = Priority.normal, updatedAt = "2026-09-25T10:00:00Z",
                )
                val dto = old.copy(title = fields["title"]?.jsonPrimitive?.content ?: old.title)
                rows[id] = dto
                ApiResult.Ok(dto)
            }
        }
    }

    @Before fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        db = Room.inMemoryDatabaseBuilder(context, CueDatabase::class.java).allowMainThreadQueries().build()
        api = FakeApi()
        store = FakeStore()
        engine = SyncEngine(db, api, store)
        WorkManagerTestInitHelper.initializeTestWorkManager(
            context,
            Configuration.Builder().setMinimumLoggingLevel(android.util.Log.DEBUG).build(),
        )
        workManager = WorkManager.getInstance(context)
        repo = PromptRepository(db, engine, api, store, context)
    }

    @After fun tearDown() = db.close()

    private fun f(vararg p: Pair<String, String>) = buildJsonObject { p.forEach { (k, v) -> put(k, v) } }
    private fun kicked() = workManager.getWorkInfosForUniqueWork(kickTag).get()

    private fun prompt(id: Long, title: String = "t") = PromptEntity(
        id = id, title = title, body = "b", projectId = null, status = Status.queued, sortOrder = 0,
        tags = "", bookmarked = false, priority = Priority.normal, blocked = false, tested = false,
        testClosely = false, updatedAt = "2026-09-24T10:00:00Z",
    )

    /** Baut store/engine/repo mit anderen Ausgangs-Zugangsdaten neu — `store` startet sonst immer frisch. */
    private fun reconnectAs(token: String?, url: String) {
        store = FakeStore(token, url)
        engine = SyncEngine(db, api, store)
        repo = PromptRepository(db, engine, api, store, context)
    }

    // ---- Regel A: create/update ----

    @Test fun `create returns null and writes nothing without a token`() = runTest {
        store.token = null
        val id = repo.create("t", "b", null, "")
        assertThat(id).isNull()
        assertThat(db.promptDao().ids()).isEmpty()
        assertThat(kicked()).isEmpty()
    }

    @Test fun `create returns the local id, writes it at once, and kicks the sync worker`() = runTest {
        val id = repo.create("Titel", "Text", null, "")
        assertThat(id).isNotNull()
        assertThat(id!!).isLessThan(0L) // lokale ID, negativ
        assertThat(db.promptDao().get(id)!!.title).isEqualTo("Titel")
        assertThat(kicked()).hasSize(1)
    }

    @Test fun `update returns false and kicks nothing for a missing row`() = runTest {
        val accepted = repo.update(999L, f("title" to "x"))
        assertThat(accepted).isFalse()
        assertThat(kicked()).isEmpty()
    }

    @Test fun `update returns true and kicks the sync worker when accepted`() = runTest {
        db.promptDao().upsert(listOf(prompt(1)))
        val accepted = repo.update(1L, f("title" to "geändert"))
        assertThat(accepted).isTrue()
        assertThat(db.promptDao().get(1)!!.title).isEqualTo("geändert")
        assertThat(kicked()).hasSize(1)
    }

    // ---- Regel B: connect() löscht bei Server-/Kontowechsel, nie grundlos ----

    @Test fun `a different server wipes local data even when the new url is unreachable`() = runTest {
        reconnectAs("alt-tok", "https://alt.example")
        db.promptDao().upsert(listOf(prompt(1)))
        db.pendingOpDao().put(PendingOpEntity(1, OpKind.UPDATE, "{}", null, 0))
        api.down = true // die neue Adresse antwortet nicht

        val result = repo.connect("https://neu.example", "neu-tok")

        assertThat(result).isEqualTo(ConnectResult.Offline)
        // Trotz gescheitertem Versuch: die alten Zugangsdaten gelten weiter …
        assertThat(store.token).isEqualTo("alt-tok")
        assertThat(store.serverUrl).isEqualTo("https://alt.example")
        // … aber die lokale Kopie des alten Kontos ist weg — sie durfte nicht
        // mit den fremden Zugangsdaten geschoben werden, und der nächste
        // erfolgreiche Abgleich füllt sie ohnehin komplett neu.
        assertThat(db.promptDao().ids()).isEmpty()
        assertThat(db.pendingOpDao().all()).isEmpty()
    }

    @Test fun `a different token on the same server wipes the old pending edit before it can be pushed`() = runTest {
        reconnectAs("alt-tok", "https://cue.celox.io")
        db.promptDao().upsert(listOf(prompt(1)))
        // Eine noch nicht geschobene Änderung unter dem ALTEN Konto.
        db.pendingOpDao().put(PendingOpEntity(1, OpKind.UPDATE, f("title" to "unterwegs").toString(), null, 0))

        val result = repo.connect("https://cue.celox.io", "neu-tok")

        assertThat(result).isEqualTo(ConnectResult.Ok)
        assertThat(store.token).isEqualTo("neu-tok")
        // Der entscheidende Beweis: die wartende Änderung des alten Kontos
        // hat NIE `patch` erreicht — sie wurde vor dem Abgleich gelöscht,
        // nicht unter dem neuen Token verschickt.
        assertThat(api.calls.none { it == "patch:1" }).isTrue()
        assertThat(db.pendingOpDao().all()).isEmpty()
        assertThat(db.promptDao().ids()).isEmpty()
    }

    @Test fun `a different token on the same server that fails to authenticate does not wipe anything`() = runTest {
        reconnectAs("alt-tok", "https://cue.celox.io")
        db.promptDao().upsert(listOf(prompt(1)))
        db.pendingOpDao().put(PendingOpEntity(1, OpKind.UPDATE, f("title" to "unterwegs").toString(), null, 0))
        api.forced = 401 // Tippfehler im neuen Token

        val result = repo.connect("https://cue.celox.io", "falsches-tok")

        assertThat(result).isEqualTo(ConnectResult.Rejected)
        // Die alte, gültige Kopie darf ein gescheiterter Verbindungsversuch
        // nicht grundlos vernichten — erst ein ERFOLGREICHER Wechsel gilt als
        // bewiesen anderes Konto.
        assertThat(db.promptDao().ids()).containsExactly(1L)
        assertThat(db.pendingOpDao().get(1)).isNotNull()
        assertThat(store.token).isEqualTo("alt-tok")
        assertThat(store.serverUrl).isEqualTo("https://cue.celox.io")
        assertThat(api.calls.none { it == "patch:1" }).isTrue()
    }

    @Test fun `reconnecting with the same url and the same token neither wipes nor drops the pending edit`() = runTest {
        reconnectAs("tok", "https://cue.celox.io")
        db.promptDao().upsert(listOf(prompt(1)))
        db.pendingOpDao().put(PendingOpEntity(1, OpKind.UPDATE, f("title" to "lokal").toString(), null, 0))

        val result = repo.connect("https://cue.celox.io", "tok")

        assertThat(result).isEqualTo(ConnectResult.Ok)
        // Nichts hat sich geändert — die wartende Änderung geht ganz normal
        // hinaus, statt von einer unnötigen Löschung verschluckt zu werden.
        assertThat(api.calls).contains("patch:1")
        assertThat(db.pendingOpDao().all()).isEmpty()
    }

    @Test fun `a bad url is rejected before anything is touched`() = runTest {
        reconnectAs("alt-tok", "https://alt.example")

        val result = repo.connect("not a url", "irrelevant")

        assertThat(result).isEqualTo(ConnectResult.BadUrl)
        assertThat(store.token).isEqualTo("alt-tok")
        assertThat(store.serverUrl).isEqualTo("https://alt.example")
        assertThat(api.calls).isEmpty()
    }

    // ---- Regel C: liveLoop dreht ohne Token nicht heiß ----

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test fun `liveLoop never returns instantly when there is no token`() = runTest {
        store.token = null
        repo.liveLoop()
        // Kein Aufruf hier hat je auf ein Netz gewartet — ohne die Verzögerung
        // wäre das ein sofortiger, kostenloser Rücksprung, den ein
        // aufrufender Dauerlauf (`while (isActive) repo.liveLoop()`) beliebig
        // oft in der Sekunde wiederholen könnte.
        assertThat(currentTime).isAtLeast(1_000L)
    }
}
