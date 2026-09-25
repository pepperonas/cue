package io.celox.cue.data.sync

import androidx.room.withTransaction
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
import io.celox.cue.data.net.ApiResult
import io.celox.cue.data.net.AppApi
import io.celox.cue.data.net.PromptDto
import io.celox.cue.data.net.code
import io.celox.cue.data.net.toEntity
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

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
 *
 * ⚠️ Gefangen wird ausschließlich das eigene Sperr-Signal. Ein Programmierfehler
 * (falsche Annahme über eine Antwort, kaputtes JSON in der Warteschlange) soll
 * laut abstürzen, statt als stilles „offline" in eine endlose Wiederholung
 * zu laufen. Unlesbare Server-Antworten kommen von `CueApi` bereits als 502.
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
        val clean = normalize(fields)
        val dao = db.pendingOpDao()
        val stored = dao.get(promptId)
        val existing = stored?.let { QueuedOp(it.promptId, it.kind, Json.parseToJsonElement(it.fieldsJson).jsonObject) }
        val merged = coalesce(existing, QueuedOp(promptId, kind, clean))
        db.withTransaction {
            // queuedAt vom ersten Eintrag übernehmen: die Warteschlange behält
            // die Reihenfolge der ERSTEN Änderung je Prompt.
            dao.put(PendingOpEntity(promptId, merged.kind, merged.fields.toString(), null, stored?.queuedAt ?: now()))
            applyLocally(promptId, clean)
        }
    }

    /**
     * Ein `null` als Wert heißt auf dem Draht nichts Eindeutiges („nicht
     * ändern" oder „leeren"?) — es wird verworfen. `unassign_project` zählt
     * nur als echtes `true`; ein `false` würde beim Zusammenfassen sonst ein
     * früheres `project_id` nicht verdrängen, aber als Feld mitreisen.
     */
    private fun normalize(fields: JsonObject): JsonObject = JsonObject(
        fields.filter { (k, v) ->
            when {
                v is JsonNull -> false
                k == "unassign_project" -> (v as? JsonPrimitive)?.booleanOrNull == true
                else -> true
            }
        },
    )

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
        dao.upsert(
            listOf(
                base.copy(
                    title = str("title") ?: base.title,
                    body = str("body") ?: base.body,
                    tags = str("tags") ?: base.tags,
                    projectId = if (unassign) null else (f["project_id"] as? JsonPrimitive)?.longOrNull ?: base.projectId,
                    status = str("status")?.let(Status::valueOf) ?: base.status,
                    priority = str("priority")?.let(Priority::valueOf) ?: base.priority,
                    bookmarked = (f["bookmarked"] as? JsonPrimitive)?.booleanOrNull ?: base.bookmarked,
                ),
            ),
        )
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

    /** Aufrufer laufen auf Dispatchers.IO (Task 7) — `clearAllTables` verweigert den Main-Thread. */
    private fun wipeLocked() {
        db.clearAllTables()
        store.clear()
    }

    /** false = offline, Rest später. Wirft RevokedSignal bei 401/403. */
    private suspend fun push(): Boolean {
        val ops = db.pendingOpDao()
        for (op in ops.all()) {
            val fields = Json.parseToJsonElement(op.fieldsJson).jsonObject
            var created = op.kind == OpKind.CREATE
            var result = if (created) api.create(fields) else api.patch(op.promptId, fields)

            // Am Rechner gelöscht, während das Telefon eine Änderung hielt: die
            // lokale Änderung gewinnt — neu anlegen aus der VOLLEN lokalen Zeile,
            // denn dieser Text existiert sonst nirgends mehr.
            if (!created && result is ApiResult.Http && result.code == 404) {
                val local = db.promptDao().get(op.promptId)
                if (local != null) {
                    created = true
                    result = api.create(createFrom(local))
                }
            }

            when (val outcome = classify(result.code())) {
                Outcome.Ok -> {
                    val row = (result as ApiResult.Ok<PromptDto>).value.toEntity()
                    db.withTransaction {
                        if (created) db.adoptServerId(op.promptId, row) else db.promptDao().upsert(listOf(row))
                        ops.remove(row.id)
                        ops.remove(op.promptId)
                    }
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

    private fun createFrom(p: PromptEntity): JsonObject = buildJsonObject {
        put("title", p.title)
        put("body", p.body)
        put("tags", p.tags)
        p.projectId?.let { put("project_id", it) }
        put("status", p.status.name)
        put("priority", p.priority.name)
        put("bookmarked", p.bookmarked)
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
            db.withTransaction {
                val pending = db.pendingOpDao().all().map { it.promptId }.toSet()
                val plan = planMerge(server.map { it.id }.toSet(), db.promptDao().ids().toSet(), pending)
                val byId = server.associateBy { it.id }
                db.promptDao().upsert(plan.upsert.map { byId.getValue(it).toEntity() })
                if (plan.delete.isNotEmpty()) db.promptDao().delete(plan.delete)
            }
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
        // ein Funkloch mitten im Holen die Änderung für immer. `updateCursor`,
        // nie `put`: `put` setzt `nextLocalId` zurück (siehe SyncStateDao).
        db.syncStateDao().updateCursor(body.cursor, now(), null)
        return SyncResult.Done
    }
}
