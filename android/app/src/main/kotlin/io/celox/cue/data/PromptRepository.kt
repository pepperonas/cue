package io.celox.cue.data

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import io.celox.cue.core.OpKind
import io.celox.cue.core.Outcome
import io.celox.cue.core.Priority
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
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
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

    /**
     * @return die lokale ID, oder `null`, wenn `enqueue` die Änderung verworfen
     * hat (kein Token) — dann wurde nichts geschrieben und nichts angestoßen.
     *
     * `engine.enqueue` UND der Worker-Anstoß laufen BEIDE in `NonCancellable`:
     * `enqueue` teilt sich einen Mutex mit `sync()` und kann hinter einem
     * Netzwerk-Aufruf warten — verlässt der Aufrufer währenddessen seinen
     * Scope (Nutzer wechselt den Bildschirm), darf die Änderung nicht
     * verloren gehen. ⚠️ Fix-Runde 1: `kick` stand vorher AUSSERHALB dieses
     * Blocks — kam der Aufrufer beim Zurückkehren auf seinen (inzwischen
     * abgebrochenen) Dispatcher, wurde genau diese Zeile nie erreicht, obwohl
     * die Änderung längst geschrieben war. Jetzt ist der ganze
     * Funktionskörper geschützt.
     */
    suspend fun create(
        title: String,
        body: String,
        projectId: Long?,
        tags: String,
        priority: Priority = Priority.normal,
    ): Long? =
        withContext(NonCancellable + Dispatchers.IO) {
            val newId = db.nextLocalId()
            val accepted = engine.enqueue(
                newId,
                OpKind.CREATE,
                buildJsonObject {
                    put("title", title)
                    put("body", body)
                    put("tags", tags)
                    if (projectId != null) put("project_id", projectId)
                    // `normal` ist der Server-Default (`AppPromptCreate.priority`) — ihn trotzdem
                    // mitzuschicken wäre kein Fehler, aber "nur was wirklich gewählt wurde"
                    // reist auch hier mit, statt jedes Mal denselben Default zu wiederholen.
                    if (priority != Priority.normal) put("priority", priority.name)
                },
            )
            if (accepted) SyncWorker.kick(context)
            if (accepted) newId else null
        }

    /** @return `true`, wenn `enqueue` die Änderung angenommen hat. Siehe [create] zum Umbau in Fix-Runde 1. */
    suspend fun update(id: Long, fields: JsonObject): Boolean = withContext(NonCancellable + Dispatchers.IO) {
        val accepted = engine.enqueue(id, OpKind.UPDATE, fields)
        if (accepted) SyncWorker.kick(context)
        accepted
    }

    suspend fun syncNow(): SyncResult = withContext(Dispatchers.IO) { engine.sync() }

    /**
     * Token prüfen, BEVOR er gespeichert wird: ein Tippfehler soll nicht erst
     * im Hintergrund auffallen.
     *
     * ⚠️ Fix-Runde 1, Regel B ersetzt: läuft komplett unter `engine.exclusive`.
     * `CueApi` liest `store.token`/`serverUrl` bei JEDEM Aufruf neu — ohne
     * diese Sperre könnte ein GLEICHZEITIG laufender Push mitten im Schieben
     * mit dem hier frisch gespeicherten Token eines ANDEREN Kontos
     * weiterlaufen, und eine noch wartende Änderung des ALTEN Kontos ginge
     * unter dem NEUEN heraus.
     *
     * Reihenfolge INNERHALB der Sperre: normalisieren (schon vorher erledigt)
     * → alte Zugangsdaten merken → die KANDIDATIN speichern → Probe-Anfrage.
     * Erst wenn die Probe durchkommt UND vorher schon ein Token gespeichert
     * war UND (Adresse ODER Token sich geändert haben), wird gelöscht — ein
     * Tippfehler in der Adresse ODER im Token darf die noch gültige, alte
     * lokale Kopie nicht grundlos vernichten. Bei JEDEM Fehlschlag werden die
     * alten Zugangsdaten EXAKT wiederhergestellt (auch die Adresse, wenn
     * vorher noch gar kein Token gespeichert war) und keine lokale Zeile
     * angefasst.
     *
     * ⚠️ Fix-Runde 2: der `engine.exclusive`-Teil läuft zusätzlich in
     * `NonCancellable` — OHNE das war `connect()` selbst noch abbrechbar:
     * verließ der Aufrufer seinen Scope (Bildschirm verlassen), NACHDEM die
     * Kandidatin gespeichert war, ABER BEVOR die Probe entschieden war
     * (`api.changes(...)` hängt selbst mitten im Warten), brach die ganze
     * `withContext`-Kette sofort ab — `restore()`/`wipeInside()` liefen NIE,
     * und die Kandidatin blieb unentschieden im Speicher stehen: das ALTE
     * Konto hätte seine wartenden Änderungen später unter dem NEUEN Token
     * geschoben. `sync()`/`schedule()` NACH der Sperre bleiben bewusst
     * abbrechbar — die holt der nächste `liveLoop()`-Tick bzw. der periodische
     * Worker ohnehin nach.
     */
    suspend fun connect(rawUrl: String, token: String): ConnectResult {
        val url = normalizeServerUrl(rawUrl) ?: return ConnectResult.BadUrl
        val cleanToken = token.trim()

        val result = withContext(NonCancellable + Dispatchers.IO) {
            engine.exclusive { wipeInside ->
                val previousToken = store.token
                val previousUrl = store.serverUrl
                store.save(url, cleanToken)

                when (classify(api.changes(since = null, waitSeconds = 0).code())) {
                    Outcome.Ok -> {
                        if (previousToken != null && (url != previousUrl || cleanToken != previousToken)) {
                            // `wipeInside()` löscht auch das gerade gespeicherte
                            // Token wieder (`store.clear()`), deshalb erneut speichern.
                            wipeInside()
                            store.save(url, cleanToken)
                        }
                        ConnectResult.Ok
                    }
                    Outcome.Revoked, is Outcome.Rejected -> {
                        restore(previousToken, previousUrl)
                        ConnectResult.Rejected
                    }
                    Outcome.Offline -> {
                        restore(previousToken, previousUrl)
                        ConnectResult.Offline
                    }
                }
            }
        }

        // AUSSERHALB der Sperre UND der NonCancellable-Deckung: sync() nimmt
        // sich seinen eigenen Mutex (nicht reentrant), und darf hier
        // abgebrochen werden — der nächste Tick holt es nach.
        if (result == ConnectResult.Ok) {
            engine.sync()
            SyncWorker.schedule(context)
        }
        return result
    }

    private fun restore(token: String?, url: String) {
        if (token != null) {
            store.save(url, token)
        } else {
            store.clear()
            store.setServerUrl(url)
        }
    }

    suspend fun disconnect() = withContext(Dispatchers.IO) { engine.wipe() }

    /**
     * Solange die App sichtbar ist: warten, bis sich etwas ändert, dann
     * abgleichen.
     *
     * ⚠️ Ohne Token nie sofort zurückkehren: ein aufrufender Dauerlauf
     * (`while (isActive) repo.liveLoop()`) würde sonst heiß drehen, solange
     * niemand verbunden ist — kein Aufruf hier wartet dann je auf ein Netz.
     * Jeder andere Rückweg (Revoked, Offline/Rejected) hat entweder schon
     * selbst einen Netzwerk-Aufruf gemacht oder verzögert explizit.
     */
    suspend fun liveLoop() {
        if (store.token == null) {
            delay(1_000L)
            return
        }
        var backoff = 1_000L
        while (coroutineContext.isActive && store.token != null) {
            val since = withContext(Dispatchers.IO) { db.syncStateDao().get()?.cursor }
            val feed = withContext(Dispatchers.IO) { api.changes(since, AppModule.LIVE_WAIT_S) }
            when (classify(feed.code())) {
                Outcome.Ok -> {
                    backoff = 1_000L
                    if (since == null || (feed as ApiResult.Ok).value.changed.isNotEmpty()) syncNow()
                }
                Outcome.Revoked -> { syncNow(); return } // die Engine räumt ab
                else -> { delay(backoff); backoff = (backoff * 2).coerceAtMost(30_000L) }
            }
        }
    }
}
