package io.celox.cue.data

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

private const val PREFS_NAME = "cue-ui"
private const val KEY_REVOKED = "device_revoked"

/**
 * Persistiertes Flag: „dieses Gerät wurde vom Server gesperrt, die lokale
 * Kopie wurde deshalb gelöscht." Überlebt einen Kaltstart — anders als
 * [io.celox.cue.ui.AppNavigator], das nur die laufende Sitzung wecken kann.
 * Gesetzt, wenn ein Abgleich `SyncResult.Revoked` meldet (Regel D);
 * gelöscht erst beim nächsten ERFOLGREICHEN `connect()`, nie bei einem
 * bloßen manuellen Abmelden.
 */
@Singleton
class RevokedNotice @Inject constructor(@ApplicationContext context: Context) {
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun isSet(): Boolean = prefs.getBoolean(KEY_REVOKED, false)
    fun mark() { prefs.edit().putBoolean(KEY_REVOKED, true).apply() }
    fun clear() { prefs.edit().remove(KEY_REVOKED).apply() }
}
