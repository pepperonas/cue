package io.celox.cue.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface PromptDao {
    @Query("SELECT * FROM prompt") fun observeAll(): Flow<List<PromptEntity>>
    /**
     * Folgt einem Alias (`id_alias`): wer noch die alte, offline vergebene ID
     * hält, sieht nach dem Umschlüsseln die neue Zeile. EINE Abfrage über
     * beide Tabellen — Room beobachtet dann beide, und es gibt keinen
     * Zwischenstand, in dem die alte Zeile weg und der Alias noch nicht da ist.
     */
    @Query("SELECT * FROM prompt WHERE id = COALESCE((SELECT newId FROM id_alias WHERE oldId = :id), :id)")
    fun observe(id: Long): Flow<PromptEntity?>
    @Query("SELECT * FROM prompt WHERE id = :id") suspend fun get(id: Long): PromptEntity?
    @Query("SELECT id FROM prompt") suspend fun ids(): List<Long>
    @Upsert suspend fun upsert(rows: List<PromptEntity>)
    @Query("DELETE FROM prompt WHERE id IN (:ids)") suspend fun delete(ids: List<Long>)

    @Transaction
    suspend fun replaceId(old: Long, updated: PromptEntity) {
        delete(listOf(old))
        upsert(listOf(updated))
    }
}

@Dao
interface ProjectDao {
    @Query("SELECT * FROM project ORDER BY sortOrder, name") fun observeAll(): Flow<List<ProjectEntity>>
    @Query("DELETE FROM project") suspend fun clear()
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun insert(rows: List<ProjectEntity>)
    @Transaction suspend fun replaceAll(rows: List<ProjectEntity>) { clear(); insert(rows) }
}

@Dao
interface TagDao {
    @Query("SELECT * FROM tag ORDER BY usageCount DESC, name") fun observeAll(): Flow<List<TagEntity>>
    @Query("DELETE FROM tag") suspend fun clear()
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun insert(rows: List<TagEntity>)
    @Transaction suspend fun replaceAll(rows: List<TagEntity>) { clear(); insert(rows) }
}

@Dao
interface PendingOpDao {
    @Query("SELECT * FROM pending_op ORDER BY queuedAt") suspend fun all(): List<PendingOpEntity>
    @Query("SELECT * FROM pending_op ORDER BY queuedAt") fun observeAll(): Flow<List<PendingOpEntity>>
    @Query("SELECT * FROM pending_op WHERE promptId = :promptId") suspend fun get(promptId: Long): PendingOpEntity?
    @Upsert suspend fun put(op: PendingOpEntity)
    @Query("DELETE FROM pending_op WHERE promptId = :promptId") suspend fun remove(promptId: Long)
    @Query("UPDATE pending_op SET lastError = :msg WHERE promptId = :promptId") suspend fun setError(promptId: Long, msg: String?)
    @Query("UPDATE pending_op SET promptId = :newId WHERE promptId = :old") suspend fun moveTo(old: Long, newId: Long)
}

@Dao
interface SyncStateDao {
    @Query("SELECT * FROM sync_state WHERE `key` = 0") suspend fun get(): SyncStateEntity?
    @Query("SELECT * FROM sync_state WHERE `key` = 0") fun observe(): Flow<SyncStateEntity?>

    /**
     * ⚠️ NICHT für Cursor/Zeit/Fehler-Schreibvorgänge verwenden — `@Upsert`
     * schreibt ALLE Spalten inkl. `nextLocalId` und setzt den fallenden
     * Zähler dabei auf den Default (-1) zurück. Ein danach offline angelegter
     * Prompt bekäme dieselbe negative ID wie ein schon wartender,
     * unsynchronisierter Prompt — dessen Zeile UND dessen Pending-Op würden
     * stillschweigend überschrieben. Für Cursor/Zeit/Fehler: `updateCursor`.
     */
    @Upsert suspend fun put(state: SyncStateEntity)

    @Query(
        "INSERT OR IGNORE INTO sync_state(`key`, cursor, lastSyncAt, lastError, nextLocalId) VALUES (0, NULL, NULL, NULL, -1)",
    )
    suspend fun ensureRow()

    @Query("UPDATE sync_state SET cursor = :cursor, lastSyncAt = :lastSyncAt, lastError = :lastError WHERE `key` = 0")
    suspend fun updateCursorRow(cursor: String?, lastSyncAt: Long?, lastError: String?)

    /** Schreibt Cursor/Zeit/Fehler, lässt `nextLocalId` unberührt — sicher auch, wenn die Zeile noch fehlt. */
    @Transaction
    suspend fun updateCursor(cursor: String?, lastSyncAt: Long?, lastError: String?) {
        ensureRow()
        updateCursorRow(cursor, lastSyncAt, lastError)
    }
}

@Dao
interface IdAliasDao {
    @Query("SELECT newId FROM id_alias WHERE oldId = :oldId") suspend fun resolve(oldId: Long): Long?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun put(alias: IdAliasEntity)

    /** Bestehende Verweise auf `old` auf `newId` umbiegen — so bleibt es bei genau einem Sprung. */
    @Query("UPDATE id_alias SET newId = :newId WHERE newId = :old") suspend fun retarget(old: Long, newId: Long)
}
