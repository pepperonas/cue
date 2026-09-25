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
     * `engine.enqueue` läuft in `NonCancellable`: es teilt sich einen Mutex mit
     * `sync()` und kann hinter einem Netzwerk-Aufruf warten — verlässt der
     * Aufrufer währenddessen seinen Scope (Nutzer wechselt den Bildschirm),
     * darf die Änderung nicht verloren gehen.
     */
    suspend fun create(title: String, body: String, projectId: Long?, tags: String): Long? {
        val (id, accepted) = withContext(NonCancellable + Dispatchers.IO) {
            val newId = db.nextLocalId()
            val ok = engine.enqueue(
                newId,
                OpKind.CREATE,
                buildJsonObject {
                    put("title", title)
                    put("body", body)
                    put("tags", tags)
                    if (projectId != null) put("project_id", projectId)
                },
            )
            newId to ok
        }
        if (accepted) SyncWorker.kick(context)
        return if (accepted) id else null
    }

    /** @return `true`, wenn `enqueue` die Änderung angenommen hat. */
    suspend fun update(id: Long, fields: JsonObject): Boolean {
        val accepted = withContext(NonCancellable + Dispatchers.IO) { engine.enqueue(id, OpKind.UPDATE, fields) }
        if (accepted) SyncWorker.kick(context)
        return accepted
    }

    suspend fun syncNow(): SyncResult = withContext(Dispatchers.IO) { engine.sync() }

    /**
     * Token prüfen, BEVOR er gespeichert wird: ein Tippfehler soll nicht erst
     * im Hintergrund auffallen.
     *
     * ⚠️ Ein anderer Server ist IMMER ein anderes Konto — das steht schon
     * fest, bevor überhaupt ein Netzwerk-Aufruf passiert ist, deshalb wird in
     * diesem Fall VOR dem Speichern gelöscht (auch wenn die neue Adresse sich
     * am Ende als nicht erreichbar erweist: die alten Zugangsdaten werden
     * danach exakt wiederhergestellt, und der nächste erfolgreiche Abgleich
     * füllt die Kopie ohnehin komplett neu aus dem Server). Ein anderes Token
     * auf DEMSELBEN Server ist erst dann sicher ein anderes Konto, wenn die
     * Anfrage damit auch tatsächlich durchkommt — vorher zu löschen hätte bei
     * einem simplen Tippfehler die alte, gültige lokale Kopie grundlos
     * vernichtet. Lokale Zeilen und wartende Änderungen eines fremden
     * Servers/Kontos dürfen nie mit den neuen Zugangsdaten geschoben werden.
     */
    suspend fun connect(rawUrl: String, token: String): ConnectResult = withContext(Dispatchers.IO) {
        val url = normalizeServerUrl(rawUrl) ?: return@withContext ConnectResult.BadUrl
        val cleanToken = token.trim()
        val previousToken = store.token
        val previousUrl = store.serverUrl
        val hadToken = previousToken != null
        val urlChanged = hadToken && url != previousUrl
        val tokenChanged = hadToken && cleanToken != previousToken

        if (urlChanged) engine.wipe()
        store.save(url, cleanToken)

        when (classify(api.changes(since = null, waitSeconds = 0).code())) {
            Outcome.Ok -> {
                // Erst jetzt ist bestätigt, dass das geänderte Token wirklich
                // funktioniert — `wipe()` löscht auch das gerade gespeicherte
                // Token wieder (`store.clear()`), deshalb muss danach erneut
                // gespeichert werden.
                if (!urlChanged && tokenChanged) {
                    engine.wipe()
                    store.save(url, cleanToken)
                }
                engine.sync()
                SyncWorker.schedule(context)
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

    private fun restore(token: String?, url: String) {
        if (token != null) store.save(url, token) else store.clear()
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
