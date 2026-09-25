package io.celox.cue.ui.edit

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.celox.cue.core.Priority
import io.celox.cue.core.Status
import io.celox.cue.data.PromptRepository
import io.celox.cue.data.db.PromptEntity
import io.celox.cue.ui.Routes
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

sealed interface SaveResult {
    data object Saved : SaveResult
    data object NoOp : SaveResult
    data object BodyRequired : SaveResult
    data object NotConnected : SaveResult

    /**
     * Fix-Runde 1, Regel 7: `update()` liefert `false` in ZWEI Fällen — kein Token, ODER die
     * Zeile existiert lokal nicht mehr (z. B. ein offline angelegter Prompt, der während dieser
     * Bearbeitung von einem Abgleich auf seine echte Server-ID umgeschlüsselt wurde). Beides als
     * „Nicht verbunden" zu melden wäre irreführend, wenn ein Token längst wieder da ist —
     * unterschieden über `repo.isConfigured` GENAU in dem Moment, in dem `update()` scheitert.
     */
    data object PromptGone : SaveResult
}

/**
 * `id`-Argument aus der Route: `Routes.NEW_ID` ("new") für Anlegen, sonst die
 * Server- oder lokale ID des zu bearbeitenden Prompts.
 */
@HiltViewModel
class EditViewModel @Inject constructor(
    private val repo: PromptRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {
    private val rawId: String = savedStateHandle.get<String>("id") ?: Routes.NEW_ID
    val isNew: Boolean = rawId == Routes.NEW_ID
    private val editId: Long? = if (isNew) null else rawId.toLongOrNull()

    /** Der beim Öffnen geladene Stand — Diff-Basis für Regel F. `null` bis geladen (oder beim Anlegen immer). */
    private var original: PromptEntity? = null
    private var seeded = false

    val projects = repo.projects.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    val tags = repo.tags.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    var title by mutableStateOf("")
    var body by mutableStateOf("")
    var projectId by mutableStateOf<Long?>(null)
    var tagsText by mutableStateOf("")
    var status by mutableStateOf(Status.queued)
    var priority by mutableStateOf(Priority.normal)
    var bodyError by mutableStateOf<String?>(null)

    /** Fix-Runde 1, Regel 6: Sperre gegen einen Doppel-Tipp auf ✓ — s. [save]. */
    var saving by mutableStateOf(false)

    private val _loaded = MutableStateFlow(isNew) // neu anlegen: sofort „geladen" (kein Server-Stand zu holen)
    val loaded: StateFlow<Boolean> = _loaded

    init {
        if (!isNew && editId != null) {
            viewModelScope.launch {
                repo.prompt(editId).collect { p ->
                    if (p != null && !seeded) {
                        seeded = true
                        original = p
                        title = p.title
                        body = p.body
                        projectId = p.projectId
                        tagsText = p.tags
                        status = p.status
                        priority = p.priority
                        _loaded.value = true
                    }
                }
            }
        }
    }

    /** Fügt einen Vorschlags-Tag an, ohne ihn zu verdoppeln (Groß-/Kleinschreibung egal). */
    fun appendTag(name: String) {
        val existing = tagsText.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        if (existing.any { it.equals(name, ignoreCase = true) }) return
        tagsText = if (existing.isEmpty()) name else "${existing.joinToString(", ")}, $name"
    }

    fun hasChanges(): Boolean {
        val o = original
        return if (isNew) {
            title.isNotBlank() || body.isNotBlank() || tagsText.isNotBlank() || projectId != null ||
                priority != Priority.normal
        } else if (o == null) {
            false // noch nicht geladen — es gibt nichts, das man verwerfen könnte
        } else {
            o.title != title || o.body != body || o.projectId != projectId ||
                o.tags != tagsText || o.status != status || o.priority != priority
        }
    }

    /**
     * Fix-Runde 1, Regel 6: `saving` wird SYNCHRON gesetzt, bevor der erste `suspend`-Aufruf
     * unterbricht — zwei fast gleichzeitig gestartete Coroutinen auf demselben (Compose-)
     * Dispatcher laufen strikt nacheinander bis zur ersten echten Unterbrechung, die zweite sieht
     * `saving == true` deshalb zuverlässig, unabhängig davon, wie schnell die Oberfläche den
     * Knopf tatsächlich deaktiviert. `NoOp` bei einem solchen Doppel-Tipp ist unschädlich — der
     * Aufrufer geht dann einfach zurück, genau wie beim „echten" `NoOp` ohne Änderungen.
     */
    suspend fun save(): SaveResult {
        if (saving) return SaveResult.NoOp
        saving = true
        try {
            if (body.isBlank()) {
                bodyError = "Text darf nicht leer sein"
                return SaveResult.BodyRequired
            }
            bodyError = null
            return if (isNew) {
                val newId = repo.create(title, body, projectId, tagsText, priority)
                if (newId == null) SaveResult.NotConnected else SaveResult.Saved
            } else {
                val id = editId ?: return SaveResult.NoOp
                val o = original ?: return SaveResult.NoOp
                val fields = changedFields(o)
                if (fields.isEmpty()) return SaveResult.NoOp
                val ok = repo.update(id, fields)
                when {
                    ok -> SaveResult.Saved
                    repo.isConfigured -> SaveResult.PromptGone
                    else -> SaveResult.NotConnected
                }
            }
        } finally {
            saving = false
        }
    }

    /** Regel F: nur was sich geändert hat geht auf die Reise; „Projekt entfernt" wird zu `unassign_project`. */
    private fun changedFields(o: PromptEntity): JsonObject = buildJsonObject {
        if (title != o.title) put("title", title)
        if (body != o.body) put("body", body)
        if (tagsText != o.tags) put("tags", tagsText)
        if (status != o.status) put("status", status.name)
        if (priority != o.priority) put("priority", priority.name)
        if (projectId != o.projectId) {
            val pid = projectId
            if (pid == null) put("unassign_project", true) else put("project_id", pid)
        }
    }
}
