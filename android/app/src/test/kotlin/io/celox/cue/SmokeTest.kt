package io.celox.cue

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class SmokeTest {
    @Test fun `the toolchain runs`() { assertThat(1 + 1).isEqualTo(2) }
}
