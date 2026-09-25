package io.celox.cue.core

import com.google.common.truth.Truth.assertThat
import com.google.common.truth.Truth.assertWithMessage
import org.junit.Test

class ServerUrlTest {
    @Test fun `adds https and strips trailing slashes`() {
        assertThat(normalizeServerUrl("cue.celox.io")).isEqualTo("https://cue.celox.io")
        assertThat(normalizeServerUrl(" https://cue.celox.io/// ")).isEqualTo("https://cue.celox.io")
    }

    @Test fun `the scheme is compared case-insensitively and normalized to lowercase`() {
        assertThat(normalizeServerUrl("HTTPS://cue.celox.io")).isEqualTo("https://cue.celox.io")
    }

    @Test fun `plain http is only allowed for local development`() {
        assertThat(normalizeServerUrl("http://cue.celox.io")).isNull()
        assertThat(normalizeServerUrl("http://10.0.2.2:8000")).isEqualTo("http://10.0.2.2:8000")
        assertThat(normalizeServerUrl("http://localhost:8000/")).isEqualTo("http://localhost:8000")
        assertThat(normalizeServerUrl("http://192.168.178.20:8000")).isEqualTo("http://192.168.178.20:8000")
    }

    @Test fun `garbage is rejected, not crashed on`() {
        for (raw in listOf(
            "", "   ", "https://", "ftp://x", "https://cue.celox.io/api", "https://a b",
            "https://cue.celox.io@evil.example", "https://user:pw@cue.celox.io",
            "https://cue.celox.io?x=1", "https://cue.celox.io#a",
        ))
            assertWithMessage(raw).that(normalizeServerUrl(raw)).isNull()
    }
}
