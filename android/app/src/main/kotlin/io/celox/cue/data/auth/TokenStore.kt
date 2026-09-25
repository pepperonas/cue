package io.celox.cue.data.auth

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

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

    override val token: String? get() = prefs.getString("token", null)
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
