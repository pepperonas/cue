package io.celox.cue.ui.list

import io.celox.cue.core.Status
import io.celox.cue.core.columnComparator
import io.celox.cue.core.parseQuery
import io.celox.cue.core.promptMatches
import io.celox.cue.data.db.ProjectEntity
import io.celox.cue.data.db.PromptEntity
import io.celox.cue.data.db.toView

data class Section(val status: Status, val prompts: List<PromptEntity>)

private val ORDER = listOf(Status.queued, Status.running, Status.done, Status.failed, Status.archived)

/**
 * Filtert + sortiert für die Liste — teilt sich die Suche mit `search-query.ts`
 * und die Reihenfolge mit `columnComparator` (Web-Board). `pendingIds` bleibt
 * im Vertrag, damit die Oberfläche später wartende Änderungen markieren kann;
 * `ListScreen` liest dafür direkt `repository.pending`.
 */
fun buildSections(
    prompts: List<PromptEntity>,
    projects: List<ProjectEntity>,
    query: String,
    @Suppress("UNUSED_PARAMETER") pendingIds: Set<Long>,
): List<Section> {
    val parsed = parseQuery(query)
    val names = projects.associate { it.id to it.name }
    val hits = prompts.filter { promptMatches(it.toView(), it.projectId?.let(names::get).orEmpty(), parsed) }
    val cmp = compareBy<PromptEntity, io.celox.cue.core.PromptView>(columnComparator) { it.toView() }
    return ORDER.mapNotNull { status ->
        hits.filter { it.status == status }.sortedWith(cmp).takeIf { it.isNotEmpty() }?.let { Section(status, it) }
    }
}
