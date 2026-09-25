package io.celox.cue.data.db

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import androidx.room.migration.Migration
import androidx.room.withTransaction
import androidx.sqlite.db.SupportSQLiteDatabase
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
    entities = [
        PromptEntity::class, ProjectEntity::class, TagEntity::class, PendingOpEntity::class,
        SyncStateEntity::class, IdAliasEntity::class,
    ],
    version = 2,
    exportSchema = true,
)
@TypeConverters(Converters::class)
abstract class CueDatabase : RoomDatabase() {
    abstract fun promptDao(): PromptDao
    abstract fun projectDao(): ProjectDao
    abstract fun tagDao(): TagDao
    abstract fun pendingOpDao(): PendingOpDao
    abstract fun syncStateDao(): SyncStateDao
    abstract fun idAliasDao(): IdAliasDao

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

    /**
     * Schiebt einen offline angelegten Prompt (negative ID) auf seine
     * echte Server-ID hoch: Prompt-Zeile UND Pending-Op in EINER
     * Transaktion, sonst könnte ein Absturz dazwischen die Zeile schon
     * verschieben, während die Warteschlange noch auf der alten ID hängt
     * (oder umgekehrt) — beides muss zusammen gelten oder gar nicht.
     */
    suspend fun adoptServerId(old: Long, row: PromptEntity) = withTransaction {
        promptDao().replaceId(old, row)
        pendingOpDao().moveTo(old, row.id)
        // Ein offener Editor / eine Detailansicht hält noch `old` — ohne den
        // Alias meldete ein Speichern dort „existiert nicht mehr" und die
        // Bearbeitung ginge verloren.
        idAliasDao().retarget(old, row.id)
        idAliasDao().put(IdAliasEntity(old, row.id))
    }

    /** Die ID, unter der ein Prompt HEUTE steht (ein Sprung über `id_alias`, sonst sie selbst). */
    suspend fun resolveId(id: Long): Long = idAliasDao().resolve(id) ?: id

    companion object {
        /** 1 → 2: `id_alias` (Fix-Runde nach dem Gesamt-Review, I1). */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("CREATE TABLE IF NOT EXISTS `id_alias` (`oldId` INTEGER NOT NULL, `newId` INTEGER NOT NULL, PRIMARY KEY(`oldId`))")
            }
        }
    }
}
