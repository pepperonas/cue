package io.celox.cue.core

import com.google.common.truth.Truth.assertThat
import com.google.common.truth.Truth.assertWithMessage
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Test

/**
 * `contracts/column-order.json` ist der gemeinsame Vertrag von
 * `app/ordering.py:display_key` und `lib/order.ts:columnComparator`. Die App
 * ist die vierte Stelle, die diese Ordnung formuliert — ohne diesen Test die
 * erste, die abdriften könnte, ohne dass etwas rot wird.
 */
class ColumnOrderContractTest {
    private val contract: JsonObject by lazy {
        // Gradle führt Unit-Tests im Modulverzeichnis (android/app) aus.
        val file = File("../../contracts/column-order.json")
        check(file.exists()) { "Vertrag nicht gefunden: ${file.absolutePath}" }
        Json.parseToJsonElement(file.readText()).jsonObject
    }

    private fun view(o: JsonObject) = PromptView(
        id = o["id"]!!.jsonPrimitive.long,
        title = "", body = "", tags = "", projectId = null,
        status = Status.valueOf(o["status"]!!.jsonPrimitive.content),
        sortOrder = o["sort_order"]!!.jsonPrimitive.int,
        priority = o["priority"]?.jsonPrimitive?.content?.let(Priority::valueOf) ?: Priority.normal,
        blocked = o["blocked"]?.jsonPrimitive?.boolean ?: false,
        tested = o["tested"]?.jsonPrimitive?.boolean ?: false,
        testClosely = o["test_closely"]?.jsonPrimitive?.boolean ?: false,
    )

    @Test fun `every contract case sorts as expected`() {
        val cases = contract["cases"]!!.jsonArray
        assertThat(cases.size).isAtLeast(18)
        for (case in cases) {
            val c = case.jsonObject
            val prompts = c["prompts"]!!.jsonArray.map { view(it.jsonObject) }
            val expected = c["expected_ids"]!!.jsonArray.map { it.jsonPrimitive.long }
            val actual = prompts.sortedWith(columnComparator).map { it.id }
            // Truth 1.4.4 removed Subject.named(); assertWithMessage() carries the
            // case name through a failure the same way the brief's `.named()` intended.
            assertWithMessage(c["name"]!!.jsonPrimitive.content).that(actual).isEqualTo(expected)
        }
    }
}
