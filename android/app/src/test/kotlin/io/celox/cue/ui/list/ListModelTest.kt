package io.celox.cue.ui.list

import com.google.common.truth.Truth.assertThat
import io.celox.cue.core.Priority
import io.celox.cue.core.Status
import io.celox.cue.data.db.ProjectEntity
import io.celox.cue.data.db.PromptEntity
import org.junit.Test

class ListModelTest {
    private fun p(id: Long, status: Status, title: String = "t$id", projectId: Long? = null, sort: Int = id.toInt(), prio: Priority = Priority.normal) =
        PromptEntity(id, title, "", projectId, status, sort, "", false, prio, false, false, false, "")

    @Test fun `sections follow the board order and drop empty ones`() {
        val s = buildSections(listOf(p(1, Status.done), p(2, Status.queued)), emptyList(), "", emptySet())
        assertThat(s.map { it.status }).containsExactly(Status.queued, Status.done).inOrder()
    }

    @Test fun `inside a section the shared column order applies`() {
        val s = buildSections(listOf(p(1, Status.queued), p(2, Status.queued, prio = Priority.high)), emptyList(), "", emptySet())
        assertThat(s.single().prompts.map { it.id }).containsExactly(2L, 1L).inOrder()
    }

    @Test fun `the search sees project names`() {
        val projects = listOf(ProjectEntity(9, "termstats", "", 0))
        val s = buildSections(listOf(p(1, Status.queued, projectId = 9), p(2, Status.queued)), projects, "\"term", emptySet())
        assertThat(s.single().prompts.map { it.id }).containsExactly(1L)
    }

    @Test fun `an offline-created prompt shows at the top of the queue`() {
        // sortOrder Int.MIN_VALUE (SyncEngine.applyLocally) — ein neuer Prompt soll
        // nicht unten in einer Queue von hunderten verschwinden.
        val s = buildSections(listOf(p(1, Status.queued), p(-1, Status.queued, sort = Int.MIN_VALUE)), emptyList(), "", setOf(-1))
        assertThat(s.single().prompts.first().id).isEqualTo(-1L)
    }
}
