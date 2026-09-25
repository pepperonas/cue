package io.celox.cue.data.db

import androidx.room.Entity
import androidx.room.PrimaryKey
import io.celox.cue.core.OpKind
import io.celox.cue.core.Priority
import io.celox.cue.core.PromptView
import io.celox.cue.core.Status

/** Server-ID, oder NEGATIV für einen offline angelegten, noch nicht geschobenen Prompt. */
@Entity(tableName = "prompt")
data class PromptEntity(
    @PrimaryKey val id: Long,
    val title: String,
    val body: String,
    val projectId: Long?,
    val status: Status,
    val sortOrder: Int,
    val tags: String,
    val bookmarked: Boolean,
    val priority: Priority,
    val blocked: Boolean,
    val tested: Boolean,
    val testClosely: Boolean,
    val updatedAt: String,
)

fun PromptEntity.toView() = PromptView(
    id, title, body, tags, projectId, status, sortOrder, priority, blocked, tested, testClosely,
)

@Entity(tableName = "project")
data class ProjectEntity(@PrimaryKey val id: Long, val name: String, val color: String, val sortOrder: Int)

@Entity(tableName = "tag")
data class TagEntity(@PrimaryKey val id: Long, val name: String, val usageCount: Int)

/** Höchstens ein Eintrag je Prompt — `coalesce` fasst zusammen, bevor geschrieben wird. */
@Entity(tableName = "pending_op")
data class PendingOpEntity(
    @PrimaryKey val promptId: Long,
    val kind: OpKind,
    val fieldsJson: String,
    val lastError: String?,
    val queuedAt: Long,
)

@Entity(tableName = "sync_state")
data class SyncStateEntity(
    @PrimaryKey val key: Int = 0,
    val cursor: String?,
    val lastSyncAt: Long?,
    val lastError: String?,
    val nextLocalId: Long = -1,
)

/**
 * Alte (negative, offline vergebene) ID → echte Server-ID. Geschrieben, wenn
 * `adoptServerId` einen offline angelegten Prompt umschlüsselt, und wenn eine
 * Bearbeitung einen am Rechner gelöschten Prompt neu anlegt. Ein Editor oder
 * eine Detailansicht, die noch die ALTE ID hält, folgt darüber der Zeile,
 * statt „existiert nicht mehr" zu melden. Immer genau EIN Sprung: beim
 * Umschlüsseln werden bestehende Verweise auf die alte ID mitgezogen.
 */
@Entity(tableName = "id_alias")
data class IdAliasEntity(@PrimaryKey val oldId: Long, val newId: Long)
