package io.celox.cue.core

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class SearchQueryTest {
    private fun p(title: String = "", body: String = "", tags: String = "") = PromptView(
        id = 1, title = title, body = body, tags = tags, projectId = null,
        status = Status.queued, sortOrder = 0, priority = Priority.normal,
        blocked = false, tested = false, testClosely = false,
    )

    @Test fun `plain text searches title body tags and project name`() {
        val q = parseQuery("Suche")
        assertThat(promptMatches(p(title = "suche fixen"), "", q)).isTrue()
        assertThat(promptMatches(p(body = "die SUCHE"), "", q)).isTrue()
        assertThat(promptMatches(p(tags = "suche"), "", q)).isTrue()
        assertThat(promptMatches(p(), "suchmaschine-suche", q)).isTrue()
        assertThat(promptMatches(p(title = "anderes"), "cue", q)).isFalse()
    }

    @Test fun `a leading quote searches project names only`() {
        val q = parseQuery("\"cue")
        assertThat(q.projectsOnly).isTrue()
        assertThat(promptMatches(p(title = "cue im Titel"), "anderes", q)).isFalse()
        assertThat(promptMatches(p(), "cue", q)).isTrue()
    }

    @Test fun `the closing quote is optional and German quotes count`() {
        assertThat(parseQuery("\"cue\"")).isEqualTo(ParsedQuery("cue", true))
        assertThat(parseQuery("„cue“")).isEqualTo(ParsedQuery("cue", true))
        assertThat(parseQuery("\"cu")).isEqualTo(ParsedQuery("cu", true))
    }

    @Test fun `a lone quote or blank matches everything`() {
        assertThat(parseQuery("\"")).isEqualTo(ParsedQuery("", false))
        assertThat(promptMatches(p(), "", parseQuery("   "))).isTrue()
    }
}
