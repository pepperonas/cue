package io.celox.cue.core

import com.google.common.truth.Truth.assertThat
import com.google.common.truth.Truth.assertWithMessage
import io.celox.cue.data.auth.usableStoredToken
import org.junit.Test

class DeviceTokenTest {
    private val t = "0123456789abcdef".repeat(4)

    @Test fun `a real token passes unchanged`() {
        assertThat(normalizeDeviceToken(t)).isEqualTo(t)
    }

    @Test fun `paste noise is removed and upper case is lowered`() {
        assertThat(normalizeDeviceToken("  ${t.substring(0, 20)}\n${t.substring(20).uppercase()} ﻿")).isEqualTo(t)
    }

    @Test fun `anything that is not 64 hex characters is refused`() {
        for (bad in listOf("", t.dropLast(1), t + "0", t.dropLast(1) + "g", t.dropLast(1) + "ä", "Bearer $t"))
            assertWithMessage(bad).that(normalizeDeviceToken(bad)).isNull()
    }

    /** Ein von einer älteren Version gespeichertes, unbrauchbares Token heißt „nicht verbunden" — kein Absturz. */
    @Test fun `a stored token that is unusable reads as absent`() {
        assertThat(usableStoredToken("to\nk")).isNull()
        assertThat(usableStoredToken(t)).isEqualTo(t)
    }
}
