package io.celox.cue.ui.detail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.celox.cue.data.PromptRepository
import io.celox.cue.data.db.PendingOpEntity
import io.celox.cue.data.db.ProjectEntity
import io.celox.cue.data.db.PromptEntity
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

@HiltViewModel
class DetailViewModel @Inject constructor(
    repo: PromptRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {
    // `CueApp` deklariert die Route "detail/{id}" mit `NavType.LongType` — im
    // `SavedStateHandle` steht dort ein echter `Long`, kein `String`. Als
    // String gelesen wirft das eine `ClassCastException` (live gefunden:
    // jedes Antippen einer Zeile stürzte die App ab).
    val promptId: Long = savedStateHandle.get<Long>("id") ?: -1L

    /**
     * Fix-Runde 1, Regel 8: `prompt` startet als `null` im `StateFlow`, GENAU wie sein Wert für
     * „nicht gefunden" — ohne dieses Flag ist „noch keine Antwort aus Room" von „diese Zeile
     * existiert nicht" nicht zu unterscheiden, und die Oberfläche blitzte kurz „Nicht gefunden."
     * auf, bevor die erste (reale) Emission ankam. `onEach` VOR `stateIn` markiert JEDE erste
     * Emission als „geladen" — auch die mit `null`, denn ein Room-Flow für eine wirklich nicht
     * existierende Zeile emittiert ebenfalls genau einmal `null`, nicht „nie".
     *
     * Fix-Runde 1 (Nacharbeit): `SharingStarted.WhileSubscribed` hätte hier bedeutet, dass
     * `onEach` erst läuft, sobald IRGENDWER `prompt` selbst abonniert — in der echten App tut das
     * `DetailScreen` immer (`collectAsStateWithLifecycle()`), aber ein Test, der NUR `loaded`
     * abwartet (Regel 8/11), abonniert `prompt` nie und hängt für immer in
     * `vm.loaded.first { it }`. `Eagerly` startet den Room-Collect sofort beim Anlegen des
     * ViewModels, unabhängig davon, wer `prompt` später beobachtet — dieselbe Eager-Semantik wie
     * `EditViewModel`s `init { viewModelScope.launch { repo.prompt(editId).collect { … } } }`, nur
     * über `stateIn` statt von Hand.
     */
    private val _loaded = MutableStateFlow(false)
    val loaded: StateFlow<Boolean> = _loaded

    val prompt = repo.prompt(promptId)
        .onEach { _loaded.value = true }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)
    val projects = repo.projects.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    val pendingOp = repo.pending
        .map { list -> list.firstOrNull { it.promptId == promptId } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DetailScreen(
    onBack: () -> Unit,
    onEdit: (Long) -> Unit,
    viewModel: DetailViewModel = hiltViewModel(),
) {
    val prompt by viewModel.prompt.collectAsStateWithLifecycle()
    val loaded by viewModel.loaded.collectAsStateWithLifecycle()
    val projects by viewModel.projects.collectAsStateWithLifecycle()
    val pendingOp by viewModel.pendingOp.collectAsStateWithLifecycle()
    val snackbarHost = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(prompt?.title?.ifBlank { "(ohne Titel)" } ?: "Prompt") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Filled.ArrowBack, contentDescription = "Zurück") }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHost) },
    ) { padding ->
        val current = prompt
        if (!loaded) {
            // Regel 8: solange Room noch nicht die erste (echte) Antwort geliefert hat, ist das
            // kein „nicht gefunden" — nur ein Ladezustand, der in der Praxis Millisekunden dauert,
            // aber live sichtbar aufblitzte.
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            return@Scaffold
        }
        if (current == null) {
            Column(Modifier.fillMaxSize().padding(padding).padding(16.dp), verticalArrangement = Arrangement.Center) {
                Text("Nicht gefunden.")
            }
            return@Scaffold
        }
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            val projectName = current.projectId?.let { id -> projects.find { it.id == id }?.name } ?: "Kein Projekt"
            Text(projectName, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary)
            if (current.tags.isNotBlank()) {
                Text(current.tags, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text("Status: ${current.status}", style = MaterialTheme.typography.bodySmall)

            pendingOp?.lastError?.let { message ->
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                    modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                ) {
                    Column(Modifier.padding(12.dp)) {
                        Text(
                            "Der Server hat die Änderung abgelehnt; sie bleibt gespeichert.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                        Text(message, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onErrorContainer)
                    }
                }
            }

            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = {
                        clipboard.setText(AnnotatedString(current.body))
                        scope.launch { snackbarHost.showSnackbar("Kopiert") }
                    },
                    modifier = Modifier.weight(1f),
                ) {
                    Icon(Icons.Filled.ContentCopy, contentDescription = null)
                    Text(" Kopieren")
                }
                FilledTonalButton(onClick = { onEdit(current.id) }, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Filled.Edit, contentDescription = null)
                    Text(" Bearbeiten")
                }
            }

            SelectionContainer {
                Text(
                    current.body,
                    style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                )
            }
        }
    }
}
