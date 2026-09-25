package io.celox.cue.core

import com.google.common.truth.Truth.assertThat
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Test

/**
 * Die App-Hälfte von `contracts/app-api.json` (Backend: `test_app_api_contract.py`).
 * Kennt die App einen Status- oder Prioritätswert nicht, ist die GANZE Prompt-Liste
 * unlesbar und der Abgleich zieht still nichts mehr.
 */
class AppApiContractTest {
    private val contract: JsonObject by lazy {
        // Gradle führt Unit-Tests im Modulverzeichnis (android/app) aus.
        val file = File("../../contracts/app-api.json")
        check(file.exists()) { "Vertrag nicht gefunden: ${file.absolutePath}" }
        Json.parseToJsonElement(file.readText()).jsonObject
    }

    private fun list(key: String) = contract[key]!!.jsonArray.map { it.jsonPrimitive.content }

    @Test fun `Status mirrors the backend's PromptStatus`() {
        assertThat(Status.entries.map { it.name }).containsExactlyElementsIn(list("prompt_status")).inOrder()
    }

    @Test fun `Priority mirrors the backend's PromptPriority`() {
        assertThat(Priority.entries.map { it.name }).containsExactlyElementsIn(list("prompt_priority")).inOrder()
    }

    @Test fun `the device token check is the backend's token pattern`() {
        assertThat(DEVICE_TOKEN.pattern).isEqualTo(contract["device_token_pattern"]!!.jsonPrimitive.content)
    }
}
