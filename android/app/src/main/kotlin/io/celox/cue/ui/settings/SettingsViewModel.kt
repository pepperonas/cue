package io.celox.cue.ui.settings

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.celox.cue.data.ConnectResult
import io.celox.cue.data.PromptRepository
import io.celox.cue.data.RevokedNotice
import io.celox.cue.data.auth.DEFAULT_SERVER
import io.celox.cue.data.sync.SyncResult
import javax.inject.Inject
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val repo: PromptRepository,
    private val revokedNotice: RevokedNotice,
) : ViewModel() {
    val syncState = repo.syncState.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    val pending = repo.pending.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val _configured = MutableStateFlow(repo.isConfigured)
    val configured: StateFlow<Boolean> = _configured

    /**
     * Ein EIGENES, einmaliges Ereignis statt „auf `configured == true` reagieren" — Settings
     * ist die Startroute ohne Vorgänger (Ersteinrichtung UND nach einer Sperre, s.
     * `AppNavTarget.DEVICE_REVOKED`), es gibt sonst keinen Weg zur Liste. Ein Effekt, der auf
     * `configured` selbst lauscht, würde auch dann feuern, wenn dieser Bildschirm bereits
     * VERBUNDEN geöffnet wird (z. B. von der Liste aus über das Einstellungen-Symbol) — und den
     * Nutzer sofort ungefragt zurückwerfen. Das Ereignis entsteht ausschließlich in [connect].
     */
    private val _connected = Channel<Unit>(capacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val connectedEvents: Flow<Unit> = _connected.receiveAsFlow()

    /** Instantan bei der ERSTEN Zeichnung dieses Bildschirms erfasst — genau der Zustand,
     * den Regel D braucht: „gilt bis zum nächsten erfolgreichen Verbinden", nicht „solange
     * die Einstellungen offen sind". */
    val showedRevokedNotice: Boolean = revokedNotice.isSet()

    var serverField by mutableStateOf(if (repo.isConfigured) repo.serverUrl else DEFAULT_SERVER)
    var tokenField by mutableStateOf("")
    var connecting by mutableStateOf(false)
    var connectError by mutableStateOf<String?>(null)

    fun connect() {
        if (connecting) return
        viewModelScope.launch {
            connecting = true
            connectError = null
            when (repo.connect(serverField, tokenField)) {
                ConnectResult.Ok -> {
                    revokedNotice.clear()
                    tokenField = ""
                    _configured.value = true
                    _connected.trySend(Unit)
                }
                ConnectResult.BadUrl -> connectError = "Adresse ungültig (https:// nötig)"
                ConnectResult.Rejected ->
                    connectError = "Token abgelehnt — in cue unter Einstellungen → Geräte neu anlegen"
                ConnectResult.Offline -> connectError = "Server nicht erreichbar"
            }
            connecting = false
        }
    }

    fun disconnect() {
        viewModelScope.launch {
            repo.disconnect()
            _configured.value = false
            serverField = DEFAULT_SERVER
        }
    }

    /** „Jetzt abgleichen" auf dem verbundenen Bildschirm — kann ebenso eine Sperre aufdecken. */
    fun syncNow() {
        viewModelScope.launch {
            if (repo.syncNow() is SyncResult.Revoked) {
                revokedNotice.mark()
                _configured.value = false
            }
        }
    }
}
