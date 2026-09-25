package io.celox.cue.data.sync

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ListenableWorker
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Der Hintergrund-Abgleich, periodisch **und** einmalig ausgelöst.
 *
 * `mapResult` ist eine reine Funktion auf dem Companion, damit der Test ohne
 * Hilt-Fabrik auskommt (`SyncWorker.mapResult(...)` direkt, keine Instanz).
 */
@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val engine: SyncEngine,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = mapResult(withContext(Dispatchers.IO) { engine.sync() })

    companion object {
        private const val PERIODIC = "cue-sync"
        private const val ONCE = "cue-sync-now"
        /** Sichtbar für den Test — s. [kick]. */
        internal val KICK_POLICY = ExistingWorkPolicy.APPEND_OR_REPLACE
        private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        /**
         * Nur `Offline` verdient einen Wiederholungsversuch. `Revoked` und
         * `NotConfigured` sind gesperrt: es gibt nichts mehr zu schieben, und
         * ein Retry-Sturm gegen 401 wäre sinnlose Last.
         */
        fun mapResult(r: SyncResult): ListenableWorker.Result =
            if (r == SyncResult.Offline) ListenableWorker.Result.retry() else ListenableWorker.Result.success()

        fun schedule(context: Context) {
            val req = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(online).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, req)
        }

        /**
         * Nach jeder lokalen Änderung: sobald Netz da ist, raus damit.
         *
         * ⚠️ `APPEND_OR_REPLACE`, NIE `REPLACE`: `REPLACE` bricht einen LAUFENDEN Abgleich ab.
         * Ein `POST` kann dann am Server längst angelegt sein, während die Antwort beim Rücksprung
         * am Abbruch zerbricht — die CREATE-Operation bleibt stehen und legt beim nächsten Lauf ein
         * Duplikat an. `KEEP` wäre die andere Falle: eine Änderung, die während des Laufs
         * gespeichert wird, wartet am Mutex und steht erst NACH dem Schieben in der Warteschlange —
         * ihr Anstoß ginge verloren, bis der periodische Lauf kommt (bis zu 15 min). Angehängt
         * läuft der neue Abgleich hinter dem laufenden und nimmt genau diese Änderung mit. Eine
         * gescheiterte/abgebrochene Kette wird ersetzt statt blockiert (das „_OR_REPLACE").
         * `SyncEngine.push()` ist zusätzlich je Operation `NonCancellable`.
         */
        fun kick(context: Context) {
            val req = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(online)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(ONCE, KICK_POLICY, req)
        }
    }
}
