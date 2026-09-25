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

    /**
     * Fix-Runde 1, Regel 4: war ein `val`, einmalig bei der ERSTEN Zeichnung erfasst — ein
     * „Jetzt abgleichen" auf dem VERBUNDENEN Bildschirm, das dabei selbst auf eine Sperre
     * stößt, hätte sie damit nie angezeigt (die Karte hätte bis zu einem Neuaufbau dieses
     * Bildschirms gefehlt, obwohl `configured` sofort auf `false` kippt). Jetzt beobachtbar,
     * mit demselben `revokedNotice.isSet()` als Startwert; `syncNow()` schreibt es neu, sobald
     * es selbst eine Sperre auflöst.
     */
    private val _showedRevokedNotice = MutableStateFlow(revokedNotice.isSet())
    val showedRevokedNotice: StateFlow<Boolean> = _showedRevokedNotice

    /**
     * Fix-Runde 1, Regel 5: IMMER die gespeicherte Adresse, nie einen `DEFAULT_SERVER`-Rückfall
     * über `isConfigured` — `store.clear()` (beim Abmelden UND bei einer Sperre) löscht nur das
     * Token, nie die URL (s. `TokenStore.clear()`/`EncryptedTokenStore`). Die alte Bedingung
     * `if (repo.isConfigured) repo.serverUrl else DEFAULT_SERVER` zeigte nach jeder Sperre den
     * Rückfall, obwohl die echte Adresse (z. B. ein lokaler Dev-Server) noch gespeichert war —
     * live beobachtet (Screenshot `shot-30`). `repo.serverUrl` liefert von sich aus schon
     * `DEFAULT_SERVER`, wenn nie etwas gespeichert wurde (`EncryptedTokenStore.serverUrl`).
     */
    var serverField by mutableStateOf(repo.serverUrl)
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
                    _showedRevokedNotice.value = false
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
            // KEIN `serverField = DEFAULT_SERVER` mehr: `disconnect()` löscht nur das Token
            // (`store.clear()`), nie die URL — dasselbe Prinzip wie oben bei der Initialisierung.
            // Ein Reset hier hätte die gerade noch korrekt angezeigte Adresse wieder verworfen,
            // sobald der Nutzer sich manuell abmeldet, und wäre beim erneuten Öffnen von
            // Einstellungen (neue ViewModel-Instanz, liest wieder `repo.serverUrl`) ohnehin
            // rückgängig gemacht worden — zwei widersprüchliche Wahrheiten je nachdem, ob der
            // Bildschirm neu aufgebaut wurde.
        }
    }

    /**
     * „Jetzt abgleichen" auf dem verbundenen Bildschirm. Regel D, Fix-Runde 1: das Setzen des
     * persistierten Flags liegt jetzt in `SyncEngine.sync()` (der eine Ort, der den Sperr-Wipe
     * ausführt) — hier wird nur noch die für DIESEN Bildschirm sichtbare, beobachtbare Kopie
     * nachgezogen, damit die rote Karte erscheint, ohne dass der Bildschirm neu aufgebaut wird.
     */
    fun syncNow() {
        viewModelScope.launch {
            if (repo.syncNow() is SyncResult.Revoked) {
                _configured.value = false
                _showedRevokedNotice.value = true
            }
        }
    }
}
