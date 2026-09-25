package io.celox.cue.data.net

import com.google.common.truth.Truth.assertThat
import io.celox.cue.data.auth.TokenStore
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Before
import org.junit.Test
import java.util.concurrent.TimeUnit

class CueApiTest {
    private val server = MockWebServer()
    private lateinit var api: CueApi

    private class FakeStore(url: String, override var token: String?) : TokenStore {
        // `val` mit eigenem Getter statt `var`: eine ECHTE `var serverUrl` erzeugt
        // auf dem JVM einen synthetischen Setter `setServerUrl(String)`, der mit
        // der gleichnamigen Interface-Methode (Fix-Runde 1, Regel 4) kollidiert.
        private var urlField: String = url
        override val serverUrl: String get() = urlField
        override fun save(url: String, token: String) { urlField = url; this.token = token }
        override fun clear() { token = null }
        override fun setServerUrl(url: String) { urlField = url }
    }

    @Before fun start() {
        server.start()
        val client = OkHttpClient.Builder().readTimeout(1, TimeUnit.SECONDS).build()
        api = CueApi(client, FakeStore(server.url("/").toString().trimEnd('/'), "tok"))
    }

    @After fun stop() = server.shutdown()

    private val promptJson = """{"id":7,"title":"T","body":"B","project_id":null,"status":"queued",
        "sort_order":1,"tags":"a","bookmarked":false,"bookmark_order":0,"tested":false,"blocked":false,
        "priority":"high","test_closely":false,"created_at":"2026-09-24T10:00:00Z",
        "updated_at":"2026-09-24T10:00:00Z","ran_at":null,"attachments":[],"brand_new_field":1}"""

    @Test fun `sends the bearer token to app routes only and ignores unknown fields`() = runTest {
        server.enqueue(MockResponse().setBody("[$promptJson]"))
        val result = api.prompts()
        val req = server.takeRequest()
        assertThat(req.path).isEqualTo("/api/app/prompts")
        assertThat(req.getHeader("Authorization")).isEqualTo("Bearer tok")
        assertThat((result as ApiResult.Ok).value.single().priority).isEqualTo(io.celox.cue.core.Priority.high)
    }

    @Test fun `401 is an http result, a dropped connection is a network result`() = runTest {
        // DISCONNECT_AT_END schließt die Verbindung, NACHDEM die 401-Antwort geschrieben ist —
        // sonst würde OkHttp die tote Verbindung für die zweite Anfrage wiederverwenden, und
        // DISCONNECT_AT_START (das nur bei einer NEUEN Verbindung greift) käme nie zum Zug.
        server.enqueue(MockResponse().setResponseCode(401).setSocketPolicy(SocketPolicy.DISCONNECT_AT_END))
        assertThat(api.prompts().code()).isEqualTo(401)
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))
        assertThat(api.prompts()).isInstanceOf(ApiResult.Network::class.java)
        assertThat(api.prompts().code()).isNull()
    }

    @Test fun `a timeout is a network result, never a 401`() = runTest {
        // Body-Delay 2 s > readTimeout 1 s hält die Zusicherung; MockWebServer.shutdown() im
        // @After wartet trotzdem, bis der Schreib-Thread mit dem Delay fertig ist — daher 2 s
        // statt der früheren 5 s, damit der Test nicht unnötig lange läuft.
        server.enqueue(MockResponse().setBody("[]").setBodyDelay(2, TimeUnit.SECONDS))
        assertThat(api.prompts()).isInstanceOf(ApiResult.Network::class.java)
    }

    @Test fun `a malformed success body becomes an unreadable result that reads like a 502, not a crash`() = runTest {
        server.enqueue(MockResponse().setBody("""{"not":"a list"}"""))
        val r = api.prompts()
        assertThat(r).isEqualTo(ApiResult.Unreadable(200))
        assertThat(r.code()).isEqualTo(502) // für LESENDE Aufrufe: wie offline, später nochmal
    }

    @Test fun `an unknown status value becomes an http 502, not a crash`() = runTest {
        server.enqueue(MockResponse().setBody("""[{"id":7,"title":"T","body":"B","project_id":null,
            "status":"paused","sort_order":1,"updated_at":"2026-09-24T10:00:00Z"}]"""))
        assertThat(api.prompts().code()).isEqualTo(502)
    }

    @Test fun `patch sends exactly the given fields`() = runTest {
        server.enqueue(MockResponse().setBody(promptJson))
        api.patch(7, buildJsonObject { put("title", "neu") })
        val req = server.takeRequest()
        assertThat(req.method).isEqualTo("PATCH")
        assertThat(req.path).isEqualTo("/api/app/prompts/7")
        assertThat(req.body.readUtf8()).isEqualTo("""{"title":"neu"}""")
    }

    @Test fun `changes passes cursor and wait`() = runTest {
        server.enqueue(MockResponse().setBody("""{"cursor":"c2","changed":["prompts"]}"""))
        val r = api.changes(since = "c1", waitSeconds = 0) as ApiResult.Ok
        assertThat(server.takeRequest().path).isEqualTo("/api/app/changes?since=c1&wait=0")
        assertThat(r.value.changed).containsExactly("prompts")
    }

    @Test fun `no token means no request at all`() = runTest {
        val bare = CueApi(OkHttpClient(), FakeStore(server.url("/").toString().trimEnd('/'), null))
        assertThat(bare.prompts().code()).isEqualTo(401)
        assertThat(server.requestCount).isEqualTo(0)
    }

    /** I4: vorher warf `header()` außerhalb des `try` — ein solches gespeichertes Token stürzte jeden Start ab. */
    @Test fun `a token with header-illegal characters is a result, not a crash`() = runTest {
        for (bad in listOf("to\nk", "tök")) {
            val api = CueApi(OkHttpClient(), FakeStore(server.url("/").toString().trimEnd('/'), bad))
            assertThat(api.prompts().code()).isEqualTo(400) // keine Sperre: kein Wipe
        }
        assertThat(server.requestCount).isEqualTo(0)
    }
}
