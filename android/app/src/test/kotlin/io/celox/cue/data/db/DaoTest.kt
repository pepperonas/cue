package io.celox.cue.data.db

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import io.celox.cue.core.OpKind
import io.celox.cue.core.Priority
import io.celox.cue.core.Status
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class DaoTest {
    private lateinit var db: CueDatabase

    @Before fun open() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), CueDatabase::class.java)
            .allowMainThreadQueries().build()
    }

    @After fun close() = db.close()

    private fun prompt(id: Long, title: String = "t") = PromptEntity(
        id = id, title = title, body = "b", projectId = null, status = Status.queued, sortOrder = 0,
        tags = "", bookmarked = false, priority = Priority.normal, blocked = false, tested = false,
        testClosely = false, updatedAt = "2026-09-24T10:00:00Z",
    )

    @Test fun upsertAndObserve() = runTest {
        db.promptDao().upsert(listOf(prompt(1), prompt(2)))
        db.promptDao().upsert(listOf(prompt(1, title = "neu")))
        val all = db.promptDao().observeAll().first()
        assertThat(all.map { it.id }).containsExactly(1L, 2L)
        assertThat(all.first { it.id == 1L }.title).isEqualTo("neu")
    }

    @Test fun replaceIdSwapsTheOfflineRowForTheServerRow() = runTest {
        db.promptDao().upsert(listOf(prompt(-1)))
        db.pendingOpDao().put(PendingOpEntity(-1, OpKind.CREATE, "{}", null, 0))
        db.promptDao().replaceId(-1, prompt(42))
        db.pendingOpDao().moveTo(-1, 42)
        assertThat(db.promptDao().ids()).containsExactly(42L)
        assertThat(db.pendingOpDao().get(42)).isNotNull()
        assertThat(db.pendingOpDao().get(-1)).isNull()
    }

    @Test fun localIdsAreNegativeAndNeverRepeat() {
        val a = db.nextLocalId()
        val b = db.nextLocalId()
        assertThat(a).isLessThan(0)
        assertThat(b).isLessThan(a)
    }

    @Test fun clearAllTablesLeavesNothing() = runTest {
        db.promptDao().upsert(listOf(prompt(1)))
        db.pendingOpDao().put(PendingOpEntity(1, OpKind.UPDATE, "{}", null, 0))
        db.clearAllTables()
        assertThat(db.promptDao().ids()).isEmpty()
        assertThat(db.pendingOpDao().all()).isEmpty()
    }
}
