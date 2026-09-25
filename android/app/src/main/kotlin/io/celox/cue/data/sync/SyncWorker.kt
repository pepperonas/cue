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

        /** Nach jeder lokalen Änderung: sobald Netz da ist, raus damit. */
        fun kick(context: Context) {
            val req = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(online)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(ONCE, ExistingWorkPolicy.REPLACE, req)
        }
    }
}
