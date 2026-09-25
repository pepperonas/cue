package io.celox.cue.core

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/**
 * Die Regeln des Abgleichs, ohne Gerät prüfbar.
 *
 * ⚠️ Die wichtigste steht in `classify`: nur 401/403 heißen „gesperrt". Ein
 * Zeitablauf, der als Sperre gelesen würde, löschte die lokale Kopie eines
 * Telefons, das nur im Tunnel steckt.
 */
sealed interface Outcome {
    data object Ok : Outcome
    data object Offline : Outcome
    data object Revoked : Outcome
    data class Rejected(val code: Int, val message: String = "") : Outcome
}

fun classify(code: Int?): Outcome = when {
    code == null -> Outcome.Offline
    code in 200..299 -> Outcome.Ok
    code == 401 || code == 403 -> Outcome.Revoked
    code == 408 || code == 429 || code >= 500 -> Outcome.Offline
    else -> Outcome.Rejected(code)
}

data class MergePlan(val upsert: List<Long>, val delete: List<Long>)

/** Ziehen überschreibt nur Zeilen OHNE offene lokale Änderung. */
fun planMerge(serverIds: Set<Long>, localIds: Set<Long>, pendingIds: Set<Long>): MergePlan =
    MergePlan(
        upsert = serverIds.filterNot { it in pendingIds }.sorted(),
        delete = localIds.filter { it !in serverIds && it !in pendingIds && it > 0 }.sorted(),
    )

enum class OpKind { CREATE, UPDATE }

data class QueuedOp(val promptId: Long, val kind: OpKind, val fields: JsonObject)

/** Muss `AppPromptUpdate` im Backend entsprechen (Teil A, Task 3). */
val ALLOWED_PATCH_FIELDS: Set<String> =
    setOf("title", "body", "project_id", "unassign_project", "status", "tags", "bookmarked", "priority")

private fun isTrue(o: JsonObject, key: String) = (o[key] as? JsonPrimitive)?.booleanOrNull == true

fun coalesce(existing: QueuedOp?, incoming: QueuedOp): QueuedOp {
    val merged = LinkedHashMap(existing?.fields ?: JsonObject(emptyMap()))
    for ((k, v) in incoming.fields) if (k in ALLOWED_PATCH_FIELDS) merged[k] = v
    // „Projekt setzen" und „Projekt entfernen" schließen sich aus; das Spätere gilt.
    if (incoming.fields.containsKey("project_id")) merged.remove("unassign_project")
    if (isTrue(incoming.fields, "unassign_project")) merged.remove("project_id")
    val kind = if (existing?.kind == OpKind.CREATE) OpKind.CREATE else incoming.kind
    if (kind == OpKind.CREATE) merged.remove("unassign_project")
    return QueuedOp(incoming.promptId, kind, JsonObject(merged))
}
