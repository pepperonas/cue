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
    @Query("SELECT * FROM prompt WHERE id = :id") fun observe(id: Long): Flow<PromptEntity?>
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
    @Upsert suspend fun put(state: SyncStateEntity)
}
