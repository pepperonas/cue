package io.celox.cue.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ClipboardManager
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.celox.cue.data.db.SyncStateEntity

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onConnected: () -> Unit = {},
    onBack: (() -> Unit)? = null,
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val configured by viewModel.configured.collectAsStateWithLifecycle()
    val syncState by viewModel.syncState.collectAsStateWithLifecycle()
    val pending by viewModel.pending.collectAsStateWithLifecycle()
    val clipboard = LocalClipboardManager.current
    var showDisconnectDialog by remember { mutableStateOf(false) }

    // Settings ist die Startroute ohne Vorgänger (Ersteinrichtung, oder nach
    // einer erkannten Sperre — s. `CueApp`s `AppNavTarget.DEVICE_REVOKED`);
    // ohne diesen Sprung gäbe es nach dem Verbinden keinen Weg zur Liste.
    LaunchedEffect(Unit) { viewModel.connectedEvents.collect { onConnected() } }

    if (showDisconnectDialog) {
        DisconnectDialog(
            pendingCount = pending.size,
            onConfirm = { showDisconnectDialog = false; viewModel.disconnect() },
            onDismiss = { showDisconnectDialog = false },
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Einstellungen") },
                navigationIcon = {
                    // Nur, wenn diese Route einen Vorgänger im Stack hat (von der Liste aus über
                    // das Zahnrad geöffnet) — als Startroute (Ersteinrichtung/Sperre) gäbe es
                    // nichts, zu dem der Pfeil zurückführen könnte.
                    onBack?.let { back ->
                        IconButton(onClick = back) {
                            Icon(Icons.Filled.ArrowBack, contentDescription = "Zurück")
                        }
                    }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (viewModel.showedRevokedNotice) {
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        "Gerät gesperrt — lokale Kopie gelöscht.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        modifier = Modifier.padding(16.dp),
                    )
                }
            }

            if (!configured) {
                NotConnectedForm(viewModel, clipboard)
            } else {
                ConnectedInfo(viewModel, syncState, pending.size, onDisconnectRequested = { showDisconnectDialog = true })
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NotConnectedForm(viewModel: SettingsViewModel, clipboard: ClipboardManager) {
    OutlinedTextField(
        value = viewModel.serverField,
        onValueChange = { viewModel.serverField = it },
        label = { Text("Server") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            value = viewModel.tokenField,
            onValueChange = { viewModel.tokenField = it },
            label = { Text("Geräte-Token") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth().weight(1f),
        )
    }
    OutlinedButton(onClick = { clipboard.getText()?.text?.let { viewModel.tokenField = it } }) {
        Text("Einfügen")
    }
    viewModel.connectError?.let {
        Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
    }
    Button(
        onClick = viewModel::connect,
        enabled = !viewModel.connecting && viewModel.serverField.isNotBlank() && viewModel.tokenField.isNotBlank(),
        modifier = Modifier.fillMaxWidth(),
    ) {
        if (viewModel.connecting) {
            CircularProgressIndicator(modifier = Modifier.padding(end = 8.dp))
        }
        Text("Verbinden")
    }
}

@Composable
private fun ConnectedInfo(
    viewModel: SettingsViewModel,
    syncState: SyncStateEntity?,
    pendingCount: Int,
    onDisconnectRequested: () -> Unit,
) {
    Text("Server: ${viewModel.serverField}", style = MaterialTheme.typography.bodyMedium)
    Text(
        "Letzter Abgleich: ${syncState?.lastSyncAt?.let { relativeTime(it) } ?: "nie"}",
        style = MaterialTheme.typography.bodyMedium,
    )
    Text("Wartende Änderungen: $pendingCount", style = MaterialTheme.typography.bodyMedium)
    FilledTonalButton(onClick = viewModel::syncNow, modifier = Modifier.fillMaxWidth()) {
        Text("Jetzt abgleichen")
    }
    Button(
        onClick = onDisconnectRequested,
        colors = androidx.compose.material3.ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text("Abmelden")
    }
}

@Composable
private fun DisconnectDialog(pendingCount: Int, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Abmelden?") },
        text = {
            Text(
                "Löscht die lokale Kopie. " +
                    if (pendingCount > 0) {
                        "$pendingCount nicht gesendete Änderung${if (pendingCount == 1) "" else "en"} " +
                            "gehen verloren."
                    } else {
                        "Nicht gesendete Änderungen gehen verloren."
                    },
            )
        },
        confirmButton = {
            TextButton(
                onClick = onConfirm,
                colors = androidx.compose.material3.ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
            ) { Text("Abmelden") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Abbrechen") } },
    )
}

private fun relativeTime(epochMillis: Long): String {
    val diffSeconds = (System.currentTimeMillis() - epochMillis) / 1000
    return when {
        diffSeconds < 60 -> "gerade eben"
        diffSeconds < 3600 -> "vor ${diffSeconds / 60} min"
        diffSeconds < 86_400 -> "vor ${diffSeconds / 3600} h"
        else -> "vor ${diffSeconds / 86_400} d"
    }
}
