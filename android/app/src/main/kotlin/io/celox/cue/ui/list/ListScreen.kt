package io.celox.cue.ui.list

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import io.celox.cue.core.Priority
import io.celox.cue.core.Status
import io.celox.cue.data.db.PendingOpEntity
import io.celox.cue.data.db.PromptEntity
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ListScreen(
    onOpenPrompt: (Long) -> Unit,
    onNewPrompt: () -> Unit,
    onOpenSettings: () -> Unit,
    viewModel: ListViewModel = hiltViewModel(),
) {
    val sections by viewModel.sections.collectAsStateWithLifecycle()
    val pending by viewModel.pending.collectAsStateWithLifecycle()
    val syncState by viewModel.syncState.collectAsStateWithLifecycle()
    val query by viewModel.query.collectAsStateWithLifecycle()
    val refreshing by viewModel.refreshing.collectAsStateWithLifecycle()
    val projects by viewModel.projects.collectAsStateWithLifecycle()
    val snackbarHost = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val lifecycleOwner = LocalLifecycleOwner.current

    // Läuft nur, solange die App sichtbar ist. `repo.liveLoop()` selbst hat
    // schon eine innere Warteschleife, solange ein Token steht — hier zusätzlich
    // in `while (isActive)`, damit ein Verbinden NACH dem Betreten von STARTED
    // (kein erneuter Lifecycle-Wechsel) das Polling trotzdem aufnimmt, statt bis
    // zum nächsten Pausieren/Fortsetzen zu warten.
    LaunchedEffect(Unit) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (isActive) viewModel.live()
        }
    }

    val pendingByPrompt = remember(pending) { pending.associateBy { it.promptId } }
    // Regel 2 (Fix-Runde 1): der Brief verlangt „Projektname + Tags" — vorher stand hier
    // `#<projectId>`. Einmal id→name gemappt statt je Zeile die Liste zu durchsuchen.
    val projectNames = remember(projects) { projects.associate { it.id to it.name } }
    val showOffline = pending.isNotEmpty() &&
        (syncState?.lastSyncAt == null || System.currentTimeMillis() - syncState!!.lastSyncAt!! > 60_000L)

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("cue") },
                actions = {
                    IconButton(onClick = onOpenSettings) {
                        Icon(Icons.Filled.Settings, contentDescription = "Einstellungen")
                    }
                },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = onNewPrompt) {
                Icon(Icons.Filled.Add, contentDescription = "Neu")
            }
        },
        snackbarHost = { SnackbarHost(snackbarHost) },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            OutlinedTextField(
                value = query,
                onValueChange = { viewModel.query.value = it },
                singleLine = true,
                label = { Text("Suchen · \"projekt für nur Projekte") },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            )
            if (showOffline) {
                Text(
                    "Offline — Änderungen werden später gesendet",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                )
            }
            // Der Zuklapp-Zustand wird HIER oben eingesammelt (im echten
            // @Composable-Kontext von ListScreen) — innerhalb des
            // `LazyListScope`-Bauplans von `LazyColumn` (unten) ist `content`
            // KEIN Composable-Kontext; ein `rememberSaveable`-Aufruf dort,
            // außerhalb von `item {}`, bricht mit „invocations can only
            // happen from the context of a @Composable function".
            val collapsedByStatus = Status.entries.associateWith { rememberSectionCollapsed(it) }
            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = viewModel::refresh,
                modifier = Modifier.fillMaxSize(),
            ) {
                LazyColumn(Modifier.fillMaxSize()) {
                    sections.forEach { section ->
                        val collapsed = collapsedByStatus.getValue(section.status)
                        item(key = "header-${section.status}") {
                            SectionHeader(section, collapsed)
                        }
                        if (!collapsed.value) {
                            items(section.prompts, key = { it.id }) { prompt ->
                                PromptRow(
                                    prompt = prompt,
                                    projectName = prompt.projectId?.let { projectNames[it] },
                                    pendingOp = pendingByPrompt[prompt.id],
                                    onClick = { onOpenPrompt(prompt.id) },
                                    onCopy = {
                                        clipboard.setText(AnnotatedString(prompt.body))
                                        scope.launch { snackbarHost.showSnackbar("Kopiert") }
                                    },
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun rememberSectionCollapsed(status: Status): androidx.compose.runtime.MutableState<Boolean> {
    val default = status != Status.queued && status != Status.running
    return rememberSaveable(status) { mutableStateOf(default) }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun SectionHeader(section: Section, collapsed: androidx.compose.runtime.MutableState<Boolean>) {
    val label = when (section.status) {
        Status.queued -> "Queued"
        Status.running -> "Running"
        Status.done -> "Done"
        Status.failed -> "Failed"
        Status.archived -> "Archived"
    }
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp) // Regel 9: Kopfzeilen sind Tippziele (Zuklappen) — Mindestgröße
            .combinedClickable(onClick = { collapsed.value = !collapsed.value })
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "$label (${section.prompts.size})",
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.primary,
        )
        Icon(
            if (collapsed.value) Icons.Filled.ExpandMore else Icons.Filled.ExpandLess,
            contentDescription = null,
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun PromptRow(
    prompt: PromptEntity,
    projectName: String?,
    pendingOp: PendingOpEntity?,
    onClick: () -> Unit,
    onCopy: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            // Regel 9: eine eigene Beschriftung fürs Lange-Drücken — sonst kündigt ein
            // Bedienungshilfen-Dienst nur „Doppeltippen zum Aktivieren, Drücken und Halten"
            // an, ohne zu sagen, WAS das Halten bewirkt.
            .combinedClickable(onClick = onClick, onLongClick = onCopy, onLongClickLabel = "Kopieren")
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                prompt.title.ifBlank { "(ohne Titel)" },
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.bodyLarge,
            )
            // Regel 2: Projektname statt `#<id>` — "Kein Projekt", wenn keins gesetzt ist ODER
            // die id (noch) in keiner geladenen Projektliste steckt (z. B. während des allerersten
            // Abgleichs), NIE die rohe Zahl.
            val subtitle = buildString {
                append(projectName ?: "Kein Projekt")
                if (prompt.tags.isNotBlank()) append(" · ${prompt.tags}")
            }
            Text(
                subtitle,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (prompt.priority == Priority.high) {
            Text(
                "!",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.error,
                // Regel 9: "!" allein sagt einem Screenreader nichts.
                modifier = Modifier.padding(horizontal = 4.dp).semantics { contentDescription = "Hohe Priorität" },
            )
        }
        if (pendingOp != null) {
            Icon(
                Icons.Filled.CloudUpload,
                contentDescription = "Wartet auf Abgleich",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 4.dp),
            )
        }
        if (pendingOp?.lastError != null) {
            Icon(
                Icons.Filled.Error,
                contentDescription = pendingOp.lastError,
                tint = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(horizontal = 4.dp),
            )
        }
    }
}
