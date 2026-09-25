package io.celox.cue.core

import com.google.common.truth.Truth.assertThat
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Test

class SyncRulesTest {
    // --- classify: „kein Netz" und „gesperrt" dürfen nie verwechselt werden.

    @Test fun `no response is offline, never revoked`() {
        assertThat(classify(null)).isEqualTo(Outcome.Offline)
    }

    @Test fun `server errors are offline too`() {
        for (code in listOf(500, 502, 503, 504)) assertThat(classify(code)).isEqualTo(Outcome.Offline)
        // 408/429: der Server lebt, will aber später — wiederholen, nicht löschen.
        assertThat(classify(408)).isEqualTo(Outcome.Offline)
        assertThat(classify(429)).isEqualTo(Outcome.Offline)
    }

    @Test fun `only 401 and 403 mean revoked`() {
        assertThat(classify(401)).isEqualTo(Outcome.Revoked)
        assertThat(classify(403)).isEqualTo(Outcome.Revoked)
        assertThat(classify(404)).isInstanceOf(Outcome.Rejected::class.java)
        assertThat(classify(409)).isInstanceOf(Outcome.Rejected::class.java)
        assertThat(classify(422)).isInstanceOf(Outcome.Rejected::class.java)
    }

    @Test fun `2xx is ok`() {
        assertThat(classify(200)).isEqualTo(Outcome.Ok)
        assertThat(classify(201)).isEqualTo(Outcome.Ok)
    }

    // --- planMerge: Ziehen überschreibt nur, was keine offene Änderung trägt.

    @Test fun `server rows are applied unless a local change is pending`() {
        val plan = planMerge(serverIds = setOf(1, 2, 3), localIds = setOf(1, 2), pendingIds = setOf(2))
        assertThat(plan.upsert).containsExactly(1L, 3L)
    }

    @Test fun `rows gone on the server are deleted locally unless pending`() {
        val plan = planMerge(serverIds = setOf(1), localIds = setOf(1, 2, 3), pendingIds = setOf(3))
        assertThat(plan.delete).containsExactly(2L)
    }

    @Test fun `offline-created prompts (negative ids) are never deleted by a pull`() {
        val plan = planMerge(serverIds = emptySet(), localIds = setOf(-1, -2), pendingIds = setOf(-1, -2))
        assertThat(plan.delete).isEmpty()
    }

    // --- coalesce: die Warteschlange hält je Prompt EINEN Eintrag.

    private fun fields(vararg pairs: Pair<String, String>) =
        buildJsonObject { pairs.forEach { (k, v) -> put(k, v) } }

    @Test fun `two edits merge, the later field wins`() {
        val a = QueuedOp(5, OpKind.UPDATE, fields("title" to "a", "body" to "x"))
        val b = QueuedOp(5, OpKind.UPDATE, fields("title" to "b"))
        val merged = coalesce(a, b)
        assertThat(merged.kind).isEqualTo(OpKind.UPDATE)
        assertThat(merged.fields["title"]).isEqualTo(JsonPrimitive("b"))
        assertThat(merged.fields["body"]).isEqualTo(JsonPrimitive("x"))
    }

    @Test fun `an edit after an offline create stays a create`() {
        val create = QueuedOp(-1, OpKind.CREATE, fields("body" to "neu", "title" to ""))
        val edit = QueuedOp(-1, OpKind.UPDATE, fields("title" to "T"))
        val merged = coalesce(create, edit)
        assertThat(merged.kind).isEqualTo(OpKind.CREATE)
        assertThat(merged.fields["title"]).isEqualTo(JsonPrimitive("T"))
        assertThat(merged.fields["body"]).isEqualTo(JsonPrimitive("neu"))
    }

    @Test fun `unassign in a create becomes a missing project`() {
        // POST kennt kein unassign_project — ein Create schickt dann einfach keins.
        val create = QueuedOp(-1, OpKind.CREATE, buildJsonObject { put("body", "x"); put("project_id", 3) })
        val edit = QueuedOp(-1, OpKind.UPDATE, buildJsonObject { put("unassign_project", true) })
        val merged = coalesce(create, edit)
        assertThat(merged.fields.containsKey("project_id")).isFalse()
        assertThat(merged.fields.containsKey("unassign_project")).isFalse()
    }

    @Test fun `setting a project after unassigning clears the unassign flag`() {
        val a = QueuedOp(5, OpKind.UPDATE, buildJsonObject { put("unassign_project", true) })
        val b = QueuedOp(5, OpKind.UPDATE, buildJsonObject { put("project_id", 7) })
        val merged = coalesce(a, b)
        assertThat(merged.fields.containsKey("unassign_project")).isFalse()
        assertThat(merged.fields["project_id"]).isEqualTo(JsonPrimitive(7))
    }

    @Test fun `no field outside the allowed subset survives`() {
        val sneaky = QueuedOp(5, OpKind.UPDATE, buildJsonObject { put("title", "t"); put("tested", true) })
        assertThat(coalesce(null, sneaky).fields.keys).containsExactly("title")
    }

    @Test fun `the allowed subset matches the server`() {
        assertThat(ALLOWED_PATCH_FIELDS).containsExactly(
            "title", "body", "project_id", "unassign_project", "status", "tags", "bookmarked", "priority",
        )
    }
}
