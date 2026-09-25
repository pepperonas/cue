package io.celox.cue.data.db

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import io.celox.cue.core.OpKind
import io.celox.cue.core.Priority
import io.celox.cue.core.Status

class Converters {
    @TypeConverter fun status(v: Status): String = v.name
    @TypeConverter fun status(v: String): Status = Status.valueOf(v)
    @TypeConverter fun priority(v: Priority): String = v.name
    @TypeConverter fun priority(v: String): Priority = Priority.valueOf(v)
    @TypeConverter fun kind(v: OpKind): String = v.name
    @TypeConverter fun kind(v: String): OpKind = OpKind.valueOf(v)
}

@Database(
    entities = [PromptEntity::class, ProjectEntity::class, TagEntity::class, PendingOpEntity::class, SyncStateEntity::class],
    version = 1,
    exportSchema = true,
)
@TypeConverters(Converters::class)
abstract class CueDatabase : RoomDatabase() {
    abstract fun promptDao(): PromptDao
    abstract fun projectDao(): ProjectDao
    abstract fun tagDao(): TagDao
    abstract fun pendingOpDao(): PendingOpDao
    abstract fun syncStateDao(): SyncStateDao

    /**
     * Nächste lokale (negative) ID. Im sync_state gezählt statt aus `min(id)`
     * abgeleitet: nach dem Hochschieben verschwindet die negative Zeile, und
     * `min(id)` gäbe dieselbe ID erneut aus — ein zweiter Offline-Prompt
     * überschriebe dann den Warteschlangen-Eintrag eines ersten.
     */
    fun nextLocalId(): Long = runInTransaction<Long> {
        val stmt = openHelper.writableDatabase
        stmt.execSQL("INSERT OR IGNORE INTO sync_state(`key`, cursor, lastSyncAt, lastError, nextLocalId) VALUES (0, NULL, NULL, NULL, -1)")
        val cursor = stmt.query("SELECT nextLocalId FROM sync_state WHERE `key` = 0")
        val id = cursor.use { it.moveToFirst(); it.getLong(0) }
        stmt.execSQL("UPDATE sync_state SET nextLocalId = nextLocalId - 1 WHERE `key` = 0")
        id
    }
}
