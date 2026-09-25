package io.celox.cue.data.sync

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import com.google.common.truth.Truth.assertWithMessage
import io.celox.cue.core.OpKind
import io.celox.cue.core.Priority
import io.celox.cue.core.Status
import io.celox.cue.data.RevokedNotice
import io.celox.cue.data.auth.TokenStore
import io.celox.cue.data.db.CueDatabase
import io.celox.cue.data.net.ApiResult
import io.celox.cue.data.net.AppApi
import io.celox.cue.data.net.ChangeFeedDto
import io.celox.cue.data.net.ProjectDto
import io.celox.cue.data.net.PromptDto
import io.celox.cue.data.net.TagListDto
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.Json
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
    private lateinit var revokedNotice: RevokedNotice

    class FakeStore : TokenStore {
        override var token: String? = "tok"
        // `val` mit eigenem Getter statt `var`: eine ECHTE `var serverUrl` erzeugt
        // auf dem JVM einen synthetischen Setter `setServerUrl(String)`, der mit
        // der gleichnamigen Interface-Methode (Fix-Runde 1, Regel 4) kollidiert.
        private var urlField = "https://cue.celox.io"
        override val serverUrl: String get() = urlField
        override fun save(url: String, token: String) { urlField = url; this.token = token }
        override fun clear() { token = null }
        override fun setServerUrl(url: String) { urlField = url }
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
        val created = mutableListOf<JsonObject>()
        /** Gesetzt: `patch` meldet sich über `patchEntered` und hält an, bis `patchGate` fertig ist. */
        var patchGate: CompletableDeferred<Unit>? = null
        val patchEntered = CompletableDeferred<Unit>()
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
            created += fields
            val id = nextId++
            val d = dto(id, fields["title"]?.jsonPrimitive?.content.orEmpty(), fields["body"]!!.jsonPrimitive.content)
            rows[id] = d; cursor++
            ApiResult.Ok(d)
        }
        override suspend fun patch(id: Long, fields: JsonObject): ApiResult<PromptDto> {
            patchGate?.let { patchEntered.complete(Unit); it.await() }
            return patchNow(id, fields)
        }
        private fun patchNow(id: Long, fields: JsonObject) = guard("patch:$id") {
            if (id in rejectPatchFor) return@guard ApiResult.Http(422, "nein")
            val old = rows[id] ?: return@guard ApiResult.Http(404, "")
            val d = old.copy(title = fields["title"]?.jsonPrimitive?.content ?: old.title)
            rows[id] = d; cursor++
            ApiResult.Ok(d)
        }
    }

    @Before fun setUp() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        db = Room.inMemoryDatabaseBuilder(context, CueDatabase::class.java)
            .allowMainThreadQueries().build()
        api = FakeApi()
        store = FakeStore()
        revokedNotice = RevokedNotice(context)
        engine = SyncEngine(db, api, store, revokedNotice)
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
        assertThat(revokedNotice.isSet()).isFalse()
        assertThat(engine.sync()).isEqualTo(SyncResult.Revoked)
        assertThat(db.promptDao().ids()).isEmpty()
        assertThat(db.pendingOpDao().all()).isEmpty()
        assertThat(store.token).isNull()
        // Fix-Runde 1 (Task 8), Regel 3: das persistierte Flag wird HIER gesetzt — dem einen Ort,
        // der den Sperr-Wipe wirklich ausführt (trifft damit auch den Hintergrund-`SyncWorker`,
        // der `sync()` genauso aufruft, aber nie über eine der UI-ViewModels läuft).
        assertThat(revokedNotice.isSet()).isTrue()
    }

    @Test fun `403 is treated like 401`() = runTest {
        api.rows[1] = api.dto(1, "a"); engine.sync()
        api.forced = 403
        assertThat(engine.sync()).isEqualTo(SyncResult.Revoked)
        assertThat(db.promptDao().ids()).isEmpty()
        assertThat(revokedNotice.isSet()).isTrue()
    }

    /** Ein manuelles Abmelden ist KEINE Sperre — `wipe()` läuft nie durch den Revoke-Zweig. */
    @Test fun `a manual disconnect never marks the revoked notice`() = runTest {
        api.rows[1] = api.dto(1, "a"); engine.sync()
        engine.wipe()
        assertThat(store.token).isNull()
        assertThat(revokedNotice.isSet()).isFalse()
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

    @Test fun `a patch answered 404 is re-sent as a create from the full local row`() = runTest {
        api.rows[1] = api.dto(1, "a", body = "Text vom Rechner"); engine.sync()
        engine.enqueue(1, OpKind.UPDATE, f("title" to "offline bearbeitet", "priority" to "high", "status" to "done"))
        engine.enqueue(1, OpKind.UPDATE, buildJsonObject { put("bookmarked", true) })
        // Am Rechner gelöscht, während das Telefon die Änderung hielt.
        api.rows.remove(1); api.cursor++
        assertThat(engine.sync()).isEqualTo(SyncResult.Done)

        // „Lokale Änderung gewinnt": der Text lebt wieder, unter neuer Server-ID.
        val sent = api.created.single()
        assertThat(sent["title"]!!.jsonPrimitive.content).isEqualTo("offline bearbeitet")
        assertThat(sent["body"]!!.jsonPrimitive.content).isEqualTo("Text vom Rechner")
        assertThat(sent["status"]!!.jsonPrimitive.content).isEqualTo("done")
        assertThat(sent["priority"]!!.jsonPrimitive.content).isEqualTo("high")
        assertThat(sent["bookmarked"]!!.jsonPrimitive.content).isEqualTo("true")
        assertWithMessage("kein project_id-Feld, wenn keins gesetzt war").that(sent.containsKey("project_id")).isFalse()
        val row = api.rows.values.single()
        assertThat(db.promptDao().ids()).containsExactly(row.id)
        assertThat(db.pendingOpDao().all()).isEmpty()
    }

    @Test fun `enqueue drops null fields and a false unassign before coalescing`() = runTest {
        api.rows[1] = api.dto(1, "a"); engine.sync()
        engine.enqueue(1, OpKind.UPDATE, buildJsonObject {
            put("project_id", JsonNull)
            put("unassign_project", false)
            put("title", "x")
        })
        val stored = Json.parseToJsonElement(db.pendingOpDao().get(1)!!.fieldsJson).jsonObject
        assertThat(stored).isEqualTo(buildJsonObject { put("title", "x") })
    }

    @Test fun `a true unassign survives normalization`() = runTest {
        api.rows[1] = api.dto(1, "a"); engine.sync()
        engine.enqueue(1, OpKind.UPDATE, buildJsonObject { put("unassign_project", true) })
        val stored = Json.parseToJsonElement(db.pendingOpDao().get(1)!!.fieldsJson).jsonObject
        assertThat(stored["unassign_project"]).isEqualTo(JsonPrimitive(true))
    }

    @Test fun `an offline create shows up locally at once`() = runTest {
        val local = db.nextLocalId()
        engine.enqueue(local, OpKind.CREATE, f("body" to "neu", "title" to "Offline"))
        assertThat(db.promptDao().get(local)!!.title).isEqualTo("Offline")
        assertThat(db.pendingOpDao().get(local)!!.kind).isEqualTo(OpKind.CREATE)
    }

    @Test fun `a cursor write keeps the local id counter`() = runTest {
        val first = db.nextLocalId()
        api.rows[1] = api.dto(1, "a"); engine.sync()
        assertThat(db.nextLocalId()).isLessThan(first)
    }

    /** Sync hält den Mutex und bekommt gleich 401; eine Bearbeitung wartet dahinter. */
    private suspend fun kotlinx.coroutines.test.TestScope.revokeWhile(waiting: suspend () -> Boolean): Boolean {
        val gate = CompletableDeferred<Unit>()
        api.patchGate = gate
        val sync = async { engine.sync() }
        api.patchEntered.await()
        val edit = async { waiting() }
        runCurrent() // die Bearbeitung hängt jetzt am Mutex
        assertWithMessage("die Bearbeitung darf vor der Sperre nicht durchkommen").that(edit.isCompleted).isFalse()
        api.forced = 401
        gate.complete(Unit)
        assertThat(sync.await()).isEqualTo(SyncResult.Revoked)
        return edit.await()
    }

    @Test fun `an edit waiting behind a revoke writes nothing`() = runTest {
        api.rows[1] = api.dto(1, "a"); engine.sync()
        engine.enqueue(1, OpKind.UPDATE, f("title" to "unterwegs"))
        val accepted = revokeWhile { engine.enqueue(1, OpKind.UPDATE, f("title" to "danach")) }
        assertThat(accepted).isFalse()
        assertThat(db.pendingOpDao().all()).isEmpty()
        assertThat(db.promptDao().ids()).isEmpty()
    }

    @Test fun `a create waiting behind a revoke writes nothing`() = runTest {
        api.rows[1] = api.dto(1, "a"); engine.sync()
        engine.enqueue(1, OpKind.UPDATE, f("title" to "unterwegs"))
        val local = db.nextLocalId()
        val accepted = revokeWhile { engine.enqueue(local, OpKind.CREATE, f("body" to "neu")) }
        assertThat(accepted).isFalse()
        assertThat(db.pendingOpDao().all()).isEmpty()
        assertThat(db.promptDao().ids()).isEmpty()
    }

    @Test fun `an update for a missing row writes nothing`() = runTest {
        assertThat(engine.enqueue(7, OpKind.UPDATE, f("title" to "erfunden"))).isFalse()
        assertThat(db.pendingOpDao().all()).isEmpty()
        assertThat(db.promptDao().ids()).isEmpty()
    }
}
