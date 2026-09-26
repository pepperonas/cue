package io.celox.cue.data.net

import io.celox.cue.data.auth.TokenStore
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** Die sechs Aufrufe der App — als Interface, damit Tests einen Fake-Server einsetzen können. */
interface AppApi {
    suspend fun prompts(): ApiResult<List<PromptDto>>
    suspend fun projects(): ApiResult<List<ProjectDto>>
    suspend fun tags(): ApiResult<TagListDto>
    suspend fun changes(since: String?, waitSeconds: Int): ApiResult<ChangeFeedDto>
    suspend fun create(fields: JsonObject): ApiResult<PromptDto>
    suspend fun patch(id: Long, fields: JsonObject): ApiResult<PromptDto>
}

/** Spricht ausschließlich mit den `/api/app`-Routen. Einen anderen Pfad kennt die App nicht. */
class CueApi(private val client: OkHttpClient, private val store: TokenStore) : AppApi {
    /**
     * Weiterleitungen werden NIE verfolgt — hier erzwungen statt in `AppModule`, damit es für
     * jeden hineingereichten Client gilt. Ein Redirect führt nie zu cue (nginx beantwortet
     * `/api/` mit nacktem Statuscode), sondern zu einer SSO-/Captive-Portal-Seite, deren 200
     * sonst als „der Server hat geschrieben" gegolten hätte (s. `ApiResult.Unreadable`).
     */
    private val http: OkHttpClient = client.newBuilder().followRedirects(false).followSslRedirects(false).build()
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val jsonType = "application/json".toMediaType()

    private suspend fun <T> call(
        method: String,
        path: String,
        body: JsonObject? = null,
        query: Map<String, String> = emptyMap(),
        serializer: KSerializer<T>,
    ): ApiResult<T> = withContext(Dispatchers.IO) {
        val token = store.token ?: return@withContext ApiResult.Http(401, "Kein Token")
        val base = "${store.serverUrl}/api/app$path".toHttpUrlOrNull()
            ?: return@withContext ApiResult.Http(400, "Server-Adresse ungültig")
        val url = base.newBuilder().apply { query.forEach { (k, v) -> addQueryParameter(k, v) } }.build()
        // ⚠️ I4: `header()` wirft `IllegalArgumentException` bei einem Zeilenumbruch oder
        // Nicht-ASCII-Zeichen im Token. Außerhalb eines `try` stürzte das die App ab — bei
        // JEDEM Start, solange ein solches Token gespeichert war. Ein 400 statt eines 401:
        // ein unbrauchbares Token ist keine Sperre, die lokale Kopie bleibt unangetastet.
        val request = try {
            Request.Builder()
                .url(url)
                .header("Authorization", "Bearer $token")
                .method(method, body?.let { it.toString().toRequestBody(jsonType) })
                .build()
        } catch (e: IllegalArgumentException) {
            return@withContext ApiResult.Http(400, "Token enthält unzulässige Zeichen")
        }
        try {
            http.newCall(request).execute().use { resp ->
                val isJson = resp.body?.contentType()?.subtype?.contains("json") == true
                val text = resp.body?.string().orEmpty()
                if (resp.code in 300..399) return@use ApiResult.Http(502, "Weiterleitung statt cue-Antwort")
                if (!resp.isSuccessful) return@use ApiResult.Http(resp.code, text.take(300))
                // Eine 2xx-Antwort, die nicht zur DTO-Form passt (falsche Struktur, unbekannter
                // Enum-Wert), ist kein Absturz wert — aber auch kein gewöhnlicher Fehler: der
                // Server hat die Anfrage ausgeführt. Siehe `ApiResult.Unreadable`.
                try {
                    ApiResult.Ok(json.decodeFromString(serializer, text))
                } catch (e: SerializationException) {
                    unreadable(resp.code, isJson)
                } catch (e: IllegalArgumentException) {
                    unreadable(resp.code, isJson)
                }
            }
        } catch (e: IOException) {
            ApiResult.Network(e)
        }
    }

    /**
     * `Unreadable` heißt „der Server hat die Anfrage AUSGEFÜHRT, nur die Antwort passt nicht"
     * — und für Schreibzugriffe folgt daraus: Op verwerfen, Serverstand holen. Das darf nur
     * gelten, wenn die Antwort wirklich von cue stammt, also JSON ist. Eine HTML-Seite (Proxy-
     * Login, Captive Portal) mit 200 ist keine Ausführung; als `Unreadable` gewertet, würde
     * ein offline angelegter Prompt lokal gelöscht, den der Server nie gesehen hat.
     */
    private fun unreadable(code: Int, isJson: Boolean): ApiResult<Nothing> =
        if (isJson) ApiResult.Unreadable(code) else ApiResult.Http(502, "Keine cue-Antwort")

    override suspend fun prompts(): ApiResult<List<PromptDto>> =
        call("GET", "/prompts", serializer = ListSerializer(PromptDto.serializer()))
    override suspend fun projects(): ApiResult<List<ProjectDto>> =
        call("GET", "/projects", serializer = ListSerializer(ProjectDto.serializer()))
    override suspend fun tags(): ApiResult<TagListDto> = call("GET", "/tags", serializer = TagListDto.serializer())

    override suspend fun changes(since: String?, waitSeconds: Int): ApiResult<ChangeFeedDto> = call(
        "GET", "/changes",
        query = buildMap { if (since != null) put("since", since); put("wait", waitSeconds.toString()) },
        serializer = ChangeFeedDto.serializer(),
    )

    override suspend fun create(fields: JsonObject): ApiResult<PromptDto> =
        call("POST", "/prompts", fields, serializer = PromptDto.serializer())
    override suspend fun patch(id: Long, fields: JsonObject): ApiResult<PromptDto> =
        call("PATCH", "/prompts/$id", fields, serializer = PromptDto.serializer())
}
