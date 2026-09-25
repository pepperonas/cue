package io.celox.cue.ui.list

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.celox.cue.data.PromptRepository
import io.celox.cue.data.RevokedNotice
import io.celox.cue.data.sync.SyncResult
import io.celox.cue.ui.AppNavTarget
import io.celox.cue.ui.AppNavigator
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

@HiltViewModel
class ListViewModel @Inject constructor(
    private val repo: PromptRepository,
    private val revokedNotice: RevokedNotice,
    private val navigator: AppNavigator,
) : ViewModel() {
    val query = MutableStateFlow("")
    val sections = combine(repo.prompts, repo.projects, query, repo.pending) { p, pr, q, pend ->
        buildSections(p, pr, q, pend.map { it.promptId }.toSet())
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    val pending = repo.pending.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    val syncState = repo.syncState.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    val projects = repo.projects.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val _refreshing = MutableStateFlow(false)
    val refreshing: StateFlow<Boolean> = _refreshing

    /** Pull-to-Refresh — feuert `syncNow()` einmal und meldet eine Sperre sofort (Regel D). */
    fun refresh() {
        if (_refreshing.value) return
        viewModelScope.launch {
            _refreshing.value = true
            try {
                if (repo.syncNow() is SyncResult.Revoked) markRevoked()
            } finally {
                _refreshing.value = false
            }
        }
    }

    /**
     * `repo.liveLoop()` schluckt sein eigenes `Revoked` intern (räumt ab, `return`)
     * — von außen ist das nicht von „noch nie verbunden" zu unterscheiden. Beide
     * Fälle laufen über denselben Weg heraus: nur wenn VORHER ein Token stand und
     * NACHHER keins mehr steht, war es eine echte Sperre.
     */
    suspend fun live() {
        val wasConfigured = repo.isConfigured
        repo.liveLoop()
        if (wasConfigured && !repo.isConfigured) markRevoked()
    }

    private fun markRevoked() {
        revokedNotice.mark()
        navigator.notify(AppNavTarget.DEVICE_REVOKED)
    }
}
