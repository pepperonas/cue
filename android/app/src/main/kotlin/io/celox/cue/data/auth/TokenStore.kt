package io.celox.cue.data.auth

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import io.celox.cue.core.normalizeDeviceToken

interface TokenStore {
    val token: String?
    val serverUrl: String
    fun save(url: String, token: String)
    fun clear()

    /**
     * Setzt NUR die Adresse, ohne das Token zu berühren — für den exakten
     * Rückweg nach einem gescheiterten Verbindungsversuch, wenn vorher noch
     * gar kein Token gespeichert war (`clear()` allein ließe die inzwischen
     * überschriebene Adresse stehen).
     */
    fun setServerUrl(url: String)
}

const val DEFAULT_SERVER = "https://cue.celox.io"

/** Token + URL, verschlüsselt mit einem Schlüssel aus dem Android-Keystore. */
class EncryptedTokenStore(context: Context) : TokenStore {
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "cue-auth",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    /**
     * I4: ein von einer älteren Version gespeichertes Token, das nicht die Form eines
     * Geräte-Tokens hat (etwa mit Zeilenumbruch eingefügt), gilt als „nicht verbunden":
     * die Einstellungen öffnen sich, statt dass die App bei jedem Start abstürzt.
     */
    override val token: String? get() = prefs.getString("token", null)?.let(::usableStoredToken)
    override val serverUrl: String get() = prefs.getString("url", null) ?: DEFAULT_SERVER

    override fun save(url: String, token: String) {
        prefs.edit().putString("url", url).putString("token", token).apply()
    }

    override fun clear() {
        prefs.edit().remove("token").apply()
    }

    override fun setServerUrl(url: String) {
        prefs.edit().putString("url", url).apply()
    }
}

/** Ein gespeichertes Token nur dann, wenn es als Geräte-Token taugt — sonst `null` („nicht verbunden"). */
fun usableStoredToken(raw: String): String? = normalizeDeviceToken(raw)
