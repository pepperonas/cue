package io.celox.cue.ui

import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow

/** App-weite Navigation, ausgelöst von einem Hintergrund-Vorgang (Live-Poll,
 * Pull-to-Refresh), unabhängig davon, welcher Bildschirm gerade oben liegt. */
enum class AppNavTarget { DEVICE_REVOKED }

/**
 * Wird der Server während einer laufenden Sitzung fündig, dass das Gerät
 * gesperrt ist (`SyncResult.Revoked`), muss die Oberfläche das SOFORT zeigen
 * — nicht erst beim nächsten Kaltstart (Verifikationspunkt 7). Ein einzelner
 * Konsument (`CueApp`) navigiert dann zu `settings`.
 */
@Singleton
class AppNavigator @Inject constructor() {
    private val channel = Channel<AppNavTarget>(capacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val events: Flow<AppNavTarget> = channel.receiveAsFlow()

    fun notify(target: AppNavTarget) {
        channel.trySend(target)
    }
}
