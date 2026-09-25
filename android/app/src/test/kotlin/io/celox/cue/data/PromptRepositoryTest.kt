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
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runCurrent
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
 * Deckt Regel A (Rückgabewerte + Worker-Anstoß NUR bei angenommener Änderung,
 * geschützt auch über einen Cancel des Aufrufers hinweg), die in Fix-Runde 1
 * ersetzte Regel B (Löschen bei Server-/Kontowechsel — mit dem Mutex von
 * `SyncEngine.exclusive`, statt außerhalb davon) und Regel C (`liveLoop`
 * dreht ohne Token nicht heiß) ab — der Auftrag verlangt hierfür ausdrücklich
 * einen eigenen JVM-Test, den der Plan nicht vorsah.
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
        // `val` mit eigenem Getter statt `var`: eine ECHTE `var serverUrl` erzeugt
        // auf dem JVM einen synthetischen Setter `setServerUrl(String)`, der mit
        // der gleichnamigen Interface-Methode (Fix-Runde 1, Regel 4) kollidiert.
        private var urlField: String = url
        override val serverUrl: String get() = urlField
        override fun save(url: String, token: String) { urlField = url; this.token = token }
        override fun clear() { token = null }
        override fun setServerUrl(url: String) { urlField = url }
    }

    /**
     * Ein Server im Speicher; `down`/`forced` erzwingen einen Ausgang, `calls`
     * hält jeden Versuch fest. `patchGate` hält `patch()` an, bis die Sperre
     * geöffnet wird — für den Test, dass `connect()` einen laufenden Push
     * wirklich abwartet (Regel B, Test d).
     */
    class FakeApi : AppApi {
        var down = false
        var forced: Int? = null
        val rows = linkedMapOf<Long, PromptDto>()
        val calls = mutableListOf<String>()
        var patchGate: CompletableDeferred<Unit>? = null
        val patchEntered = CompletableDeferred<Unit>()

        /** Hält `changes()` an, bis die Sperre geöffnet wird — für den Cancel-mitten-in-der-Probe-Test (Fix-Runde 2). */
        var changesGate: CompletableDeferred<Unit>? = null
        val changesEntered = CompletableDeferred<Unit>()

        private fun <T> guard(block: () -> ApiResult<T>): ApiResult<T> {
            if (down) return ApiResult.Network(IOException("offline"))
            forced?.let { return ApiResult.Http(it, "") }
            return block()
        }

        override suspend fun prompts() = guard { ApiResult.Ok(rows.values.toList()) }
        override suspend fun projects() = guard { ApiResult.Ok(emptyList<ProjectDto>()) }
        override suspend fun tags() = guard { ApiResult.Ok(TagListDto(emptyList())) }

        override suspend fun changes(since: String?, waitSeconds: Int): ApiResult<ChangeFeedDto> {
            changesGate?.let { changesEntered.complete(Unit); it.await() }
            return guard { ApiResult.Ok(ChangeFeedDto("c1")) }
        }

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
            patchGate?.let { patchEntered.complete(Unit); it.await() }
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

    /**
     * Fix-Runde 1, Regel 3: der Worker-Anstoß hing vorher AUSSERHALB des
     * `NonCancellable`-Blocks — kam der Aufrufer beim Rücksprung auf seinen
     * (inzwischen abgebrochenen) Dispatcher, wurde die Zeile nie erreicht.
     *
     * ⚠️ Was diesen Test wirklich sicher macht (NICHT: „`runCurrent()`
     * garantiert, dass der Mutex erreicht wurde" — `Dispatchers.IO` liegt
     * AUSSERHALB des Test-Schedulers, `runCurrent()` kann dort nichts mehr
     * steuern). Zwei getrennte Tatsachen tragen den Test: (a) `runCurrent()`
     * schiebt die Coroutine nur so weit an, wie der virtuelle Scheduler kann
     * — bis zum Dispatch-Wechsel auf `Dispatchers.IO` INNERHALB des
     * `NonCancellable`-Blocks; ab da läuft sie auf einem echten Thread
     * weiter, und WIE WEIT sie bis zum `cancel()` real gekommen ist, bleibt
     * offen. (b) Das ist egal, weil ab genau diesem Dispatch-Wechsel der
     * gesamte restliche Code unter `NonCancellable` steht — `cancel()` kann
     * darin an KEINER Stelle mehr beobachtet werden, egal ob die Coroutine
     * gerade `enqueue()` aufruft, am Mutex hängt oder die Schreibarbeit
     * selbst ausführt. `runCurrent()` schließt nur den einen Fall aus, den es
     * ausschließen muss: dass `cancel()` VOR dem Start der Coroutine feuert
     * und der Körper nie läuft.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test fun `create finishes and kicks the worker even if the caller is cancelled while it waits for the lock`() =
        runTest {
            val entered = CompletableDeferred<Unit>()
            val release = CompletableDeferred<Unit>()
            val holder = launch { engine.exclusive { entered.complete(Unit); release.await() } }
            runCurrent()
            entered.await()

            var result: Long? = -999L
            val caller = launch { result = repo.create("Titel", "Text", null, "") }
            // `runCurrent()` schiebt nur bis zum Dispatch auf Dispatchers.IO an
            // (danach real unbekannt, wie weit) — das reicht: ab dort ist der
            // restliche Code in NonCancellable gehüllt und für `cancel()`
            // unerreichbar, egal wo genau er real gerade steht.
            runCurrent()
            caller.cancel()

            release.complete(Unit)
            holder.join()
            caller.join() // wartet, bis der geschützte Block fertig ist, auch wenn `caller` abgebrochen ist

            assertThat(result).isEqualTo(-999L) // der Aufrufer hat das Ergebnis NIE gesehen …
            // … aber die Wirkung ist trotzdem da: geschrieben UND angestoßen.
            assertThat(db.promptDao().ids()).hasSize(1)
            assertThat(kicked()).hasSize(1)
        }

    // ---- Regel B (Fix-Runde 1): connect() löscht nur nach erfolgreicher Probe, nie grundlos ----

    @Test fun `a failed probe after a url change leaves local data untouched and restores the old credentials`() =
        runTest {
            reconnectAs("alt-tok", "https://alt.example")
            db.promptDao().upsert(listOf(prompt(1)))
            db.pendingOpDao().put(PendingOpEntity(1, OpKind.UPDATE, f("title" to "unterwegs").toString(), null, 0))
            api.down = true // die neue Adresse antwortet nicht

            val result = repo.connect("https://neu.example", "neu-tok")

            assertThat(result).isEqualTo(ConnectResult.Offline)
            // Ein Tippfehler in der Adresse darf die noch gültige, alte Kopie
            // nicht vernichten — erst eine ERFOLGREICHE Probe gilt als
            // bewiesener Kontowechsel.
            assertThat(db.promptDao().ids()).containsExactly(1L)
            assertThat(db.pendingOpDao().get(1)).isNotNull()
            assertThat(store.token).isEqualTo("alt-tok")
            assertThat(store.serverUrl).isEqualTo("https://alt.example")
        }

    @Test fun `a successful probe with a different token wipes the old pending edit before it can be pushed`() =
        runTest {
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

    @Test fun `a successful probe after a url change also wipes and stores the new url and token`() = runTest {
        reconnectAs("alt-tok", "https://alt.example")
        db.promptDao().upsert(listOf(prompt(1)))
        db.pendingOpDao().put(PendingOpEntity(1, OpKind.UPDATE, f("title" to "unterwegs").toString(), null, 0))

        val result = repo.connect("https://neu.example", "neu-tok")

        assertThat(result).isEqualTo(ConnectResult.Ok)
        assertThat(store.token).isEqualTo("neu-tok")
        assertThat(store.serverUrl).isEqualTo("https://neu.example")
        assertThat(api.calls.none { it == "patch:1" }).isTrue()
        assertThat(db.pendingOpDao().all()).isEmpty()
    }

    @Test fun `a different token on the same server that fails to authenticate does not wipe anything`() = runTest {
        reconnectAs("alt-tok", "https://cue.celox.io")
        db.promptDao().upsert(listOf(prompt(1)))
        db.pendingOpDao().put(PendingOpEntity(1, OpKind.UPDATE, f("title" to "unterwegs").toString(), null, 0))
        api.forced = 401 // Tippfehler im neuen Token

        val result = repo.connect("https://cue.celox.io", "falsches-tok")

        assertThat(result).isEqualTo(ConnectResult.Rejected)
        assertThat(db.promptDao().ids()).containsExactly(1L)
        assertThat(db.pendingOpDao().get(1)).isNotNull()
        assertThat(store.token).isEqualTo("alt-tok")
        assertThat(store.serverUrl).isEqualTo("https://cue.celox.io")
        assertThat(api.calls.none { it == "patch:1" }).isTrue()
    }

    @Test fun `reconnecting with the same url and the same token neither wipes nor drops the pending edit`() =
        runTest {
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

    /** Regel 4: die Adresse muss beim Rückweg auch dann stimmen, wenn vorher noch gar kein Token gespeichert war. */
    @Test fun `a failed first connection attempt restores the previous url even without a previous token`() =
        runTest {
            reconnectAs(null, "https://original.example")
            api.down = true

            val result = repo.connect("https://neu.example", "irgendein-tok")

            assertThat(result).isEqualTo(ConnectResult.Offline)
            assertThat(store.token).isNull()
            assertThat(store.serverUrl).isEqualTo("https://original.example")
        }

    @Test fun `a bad url is rejected before anything is touched`() = runTest {
        reconnectAs("alt-tok", "https://alt.example")

        val result = repo.connect("not a url", "irrelevant")

        assertThat(result).isEqualTo(ConnectResult.BadUrl)
        assertThat(store.token).isEqualTo("alt-tok")
        assertThat(store.serverUrl).isEqualTo("https://alt.example")
        assertThat(api.calls).isEmpty()
    }

    /**
     * Regel 1+2, Test d: `connect()` muss einen laufenden Push abwarten,
     * bevor es Zugangsdaten anfasst. `patchGate` hält den Push mitten im
     * EINEN laufenden `api.patch(1, …)`-Aufruf an — solange die Sperre nicht
     * freigegeben ist, darf `connect()` nichts geschrieben haben.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test fun `connect waits for a sync in progress before it touches the store`() = runTest {
        reconnectAs("alt-tok", "https://cue.celox.io")
        db.promptDao().upsert(listOf(prompt(1)))
        db.pendingOpDao().put(PendingOpEntity(1, OpKind.UPDATE, f("title" to "unterwegs").toString(), null, 0))

        val gate = CompletableDeferred<Unit>()
        api.patchGate = gate
        val syncJob = launch { engine.sync() }
        api.patchEntered.await() // push() haelt jetzt den Mutex und wartet in patch(1, …)

        val connectJob = launch { repo.connect("https://cue.celox.io", "neu-tok") }
        // `runCurrent()` schiebt `connectJob` nur bis zum Dispatch auf
        // Dispatchers.IO an (real danach unbekannt, wie weit). Das genügt
        // hier trotzdem: solange `gate` nicht freigegeben ist, hält `syncJob`
        // den Mutex — `connect()` kann `store.save(...)` also unter GAR
        // keinen Umständen schon ausgeführt haben, egal ob es noch dispatcht
        // wird, vor dem Mutex wartet oder gerade erst hineinruft.
        runCurrent()

        // Solange der Push blockiert: exakt EIN Versuch, und das Token ist unveraendert.
        assertThat(api.calls.count { it == "patch:1" }).isEqualTo(1)
        assertThat(store.token).isEqualTo("alt-tok")

        gate.complete(Unit)
        syncJob.join()
        connectJob.join()

        assertThat(store.token).isEqualTo("neu-tok")
    }

    /**
     * Fix-Runde 2: `connect()` selbst war noch abbrechbar. Verließ der
     * Aufrufer seinen Scope, NACHDEM die Kandidatin gespeichert war, ABER
     * BEVOR die Probe entschieden war (`api.changes(...)` hängt selbst mitten
     * im Warten), brach die ganze `withContext`-Kette sofort ab —
     * `restore()` lief NIE, und die Kandidatin blieb unentschieden im
     * Speicher stehen: das alte Konto hätte seine wartenden Änderungen
     * später unter dem neuen Token geschoben. `changesGate` hält die Probe
     * mitten im Warten an, `changesEntered` beweist, dass sie dort wirklich
     * angekommen ist (kein Rätselraten über Thread-Timing); danach wird
     * abgebrochen UND erst dann ein 5xx freigegeben.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test fun `a connect cancelled mid-probe still restores exactly instead of leaving the candidate stuck`() =
        runTest {
            reconnectAs("alt-tok", "https://cue.celox.io")
            db.promptDao().upsert(listOf(prompt(1)))
            db.pendingOpDao().put(PendingOpEntity(1, OpKind.UPDATE, f("title" to "unterwegs").toString(), null, 0))

            val gate = CompletableDeferred<Unit>()
            api.changesGate = gate
            val connectJob = launch { repo.connect("https://cue.celox.io", "neu-tok") }
            runCurrent()
            api.changesEntered.await() // die Probe läuft, hängt jetzt im Gate — die Kandidatin ist schon gespeichert

            connectJob.cancel() // der Aufrufer verlässt seinen Scope, während die Probe noch offen ist

            api.forced = 503 // Fehlschlag, sobald das Gate gleich freigegeben wird
            gate.complete(Unit)
            connectJob.join() // wartet, bis der NonCancellable-Block trotz Cancel fertig ist (restore() inklusive)

            // Die Kandidatin darf NIE unentschieden stehen bleiben.
            assertThat(store.token).isEqualTo("alt-tok")
            assertThat(store.serverUrl).isEqualTo("https://cue.celox.io")
            assertThat(db.promptDao().ids()).containsExactly(1L)
            assertThat(db.pendingOpDao().get(1)).isNotNull()
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
