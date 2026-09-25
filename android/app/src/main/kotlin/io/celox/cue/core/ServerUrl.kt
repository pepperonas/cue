package io.celox.cue.core

import java.net.URI

private val LOCAL_HOST = Regex("""^(localhost|10\.0\.2\.2|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$""")

/** Eine eingegebene Server-Adresse in die Form bringen, die der Client voranstellt. */
fun normalizeServerUrl(raw: String): String? {
    val trimmed = raw.trim()
    if (trimmed.isEmpty()) return null
    // Schema-Erkennung ZUERST am ungekürzten Text — sonst frisst trimEnd('/') das "//"
    // von "https://" komplett weg ("https:") und die Zeile hängt fälschlich ein zweites
    // "https://" davor ("https://https:").
    var text = if (trimmed.contains("://")) trimmed else "https://$trimmed"
    text = text.trimEnd('/')
    if (text.isEmpty()) return null
    val uri = runCatching { URI(text) }.getOrNull() ?: return null
    val host = uri.host ?: return null
    if (!uri.path.isNullOrEmpty()) return null  // die App hängt /api/app/… selbst an
    if (uri.rawQuery != null || uri.rawFragment != null) return null  // dito
    // "user@evil.example" lässt den Host-Teil auf ein anderes Ziel zeigen, als es scheint
    // ("https://cue.celox.io@evil.example" hat den REALEN Host evil.example) — das Geräte-
    // Token darf niemals an ein derart verschleiertes Ziel gehen.
    if (uri.userInfo != null) return null
    val scheme = uri.scheme?.lowercase() ?: return null
    val normalized = scheme + text.substring(text.indexOf("://"))
    return when (scheme) {
        "https" -> normalized
        "http" -> if (LOCAL_HOST.matches(host)) normalized else null
        else -> null
    }
}
