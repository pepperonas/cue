package io.celox.cue.data.sync

import androidx.work.ListenableWorker
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Reine Abbildung, kein Worker-Objekt nötig — `mapResult` ist eine Funktion
 * auf dem Companion, deshalb ruft der Test sie direkt auf statt über einen
 * Wrapper-Helfer (der nur verschleiern würde, dass hier nichts eine Fabrik
 * braucht).
 */
@RunWith(RobolectricTestRunner::class)
class SyncWorkerTest {
    @Test fun `offline retries, everything else is done`() {
        assertThat(SyncWorker.mapResult(SyncResult.Offline)).isEqualTo(ListenableWorker.Result.retry())
        assertThat(SyncWorker.mapResult(SyncResult.Done)).isEqualTo(ListenableWorker.Result.success())
        // Gesperrt: kein Wiederholen — es gibt nichts mehr zu schieben, und ein
        // Retry-Sturm gegen 401 wäre sinnlose Last.
        assertThat(SyncWorker.mapResult(SyncResult.Revoked)).isEqualTo(ListenableWorker.Result.success())
        assertThat(SyncWorker.mapResult(SyncResult.NotConfigured)).isEqualTo(ListenableWorker.Result.success())
    }
}
