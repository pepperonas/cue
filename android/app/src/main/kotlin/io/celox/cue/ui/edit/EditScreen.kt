package io.celox.cue.ui.edit

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.celox.cue.core.Priority
import io.celox.cue.core.Status
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditScreen(
    onBack: () -> Unit,
    viewModel: EditViewModel = hiltViewModel(),
) {
    val projects by viewModel.projects.collectAsStateWithLifecycle()
    val tags by viewModel.tags.collectAsStateWithLifecycle()
    val snackbarHost = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var showDiscardDialog by remember { mutableStateOf(false) }

    val attemptBack: () -> Unit = {
        if (viewModel.hasChanges()) showDiscardDialog = true else onBack()
    }
    BackHandler(onBack = attemptBack)

    val doSave: () -> Unit = {
        scope.launch {
            when (viewModel.save()) {
                SaveResult.Saved, SaveResult.NoOp -> onBack()
                SaveResult.BodyRequired -> Unit // Fehler steht am Feld
                SaveResult.NotConnected ->
                    scope.launch { snackbarHost.showSnackbar("Nicht verbunden — in den Einstellungen verbinden") }
            }
        }
    }

    if (showDiscardDialog) {
        AlertDialog(
            onDismissRequest = { showDiscardDialog = false },
            title = { Text("Änderungen verwerfen?") },
            text = { Text("Die noch nicht gespeicherten Änderungen gehen verloren.") },
            confirmButton = {
                TextButton(onClick = { showDiscardDialog = false; onBack() }) { Text("Verwerfen") }
            },
            dismissButton = {
                TextButton(onClick = { showDiscardDialog = false }) { Text("Weiter bearbeiten") }
            },
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (viewModel.isNew) "Neuer Prompt" else "Bearbeiten") },
                navigationIcon = {
                    IconButton(onClick = attemptBack) { Icon(Icons.Filled.ArrowBack, contentDescription = "Zurück") }
                },
                actions = {
                    IconButton(onClick = doSave) { Icon(Icons.Filled.Check, contentDescription = "Speichern") }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHost) },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            OutlinedTextField(
                value = viewModel.title,
                onValueChange = { viewModel.title = it },
                label = { Text("Titel") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            OutlinedTextField(
                value = viewModel.body,
                onValueChange = { viewModel.body = it; if (it.isNotBlank()) viewModel.bodyError = null },
                label = { Text("Text") },
                isError = viewModel.bodyError != null,
                supportingText = { viewModel.bodyError?.let { Text(it) } },
                modifier = Modifier.fillMaxWidth().height(220.dp),
            )

            var projectMenuOpen by remember { mutableStateOf(false) }
            ExposedDropdownMenuBox(expanded = projectMenuOpen, onExpandedChange = { projectMenuOpen = it }) {
                OutlinedTextField(
                    value = projects.find { it.id == viewModel.projectId }?.name ?: "Kein Projekt",
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Projekt") },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = projectMenuOpen) },
                    modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryEditable),
                )
                ExposedDropdownMenu(expanded = projectMenuOpen, onDismissRequest = { projectMenuOpen = false }) {
                    DropdownMenuItem(
                        text = { Text("Kein Projekt") },
                        onClick = { viewModel.projectId = null; projectMenuOpen = false },
                    )
                    projects.forEach { project ->
                        DropdownMenuItem(
                            text = { Text(project.name) },
                            onClick = { viewModel.projectId = project.id; projectMenuOpen = false },
                        )
                    }
                }
            }

            OutlinedTextField(
                value = viewModel.tagsText,
                onValueChange = { viewModel.tagsText = it },
                label = { Text("Tags (Komma-getrennt)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            if (tags.isNotEmpty()) {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(tags.take(12), key = { it.id }) { tag ->
                        FilterChip(
                            selected = false,
                            onClick = { viewModel.appendTag(tag.name) },
                            label = { Text(tag.name) },
                        )
                    }
                }
            }

            if (!viewModel.isNew) {
                Text("Status", style = MaterialTheme.typography.labelLarge)
                val editableStatuses = listOf(Status.queued, Status.running, Status.done)
                SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                    editableStatuses.forEachIndexed { index, s ->
                        SegmentedButton(
                            selected = viewModel.status == s,
                            onClick = { viewModel.status = s },
                            shape = SegmentedButtonDefaults.itemShape(index = index, count = editableStatuses.size),
                        ) { Text(s.name) }
                    }
                }
            }

            Text("Priorität", style = MaterialTheme.typography.labelLarge)
            val priorities = listOf(Priority.low, Priority.normal, Priority.high)
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                priorities.forEachIndexed { index, p ->
                    SegmentedButton(
                        selected = viewModel.priority == p,
                        onClick = { viewModel.priority = p },
                        shape = SegmentedButtonDefaults.itemShape(index = index, count = priorities.size),
                    ) { Text(p.name) }
                }
            }
        }
    }
}
