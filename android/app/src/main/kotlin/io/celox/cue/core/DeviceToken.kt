package io.celox.cue.core

/**
 * Die Form, die das Backend ausgibt: `secrets.token_hex(32)` in
 * `backend/app/devices.py` — genau 64 Kleinbuchstaben-Hex-Zeichen. Gepinnt in
 * `contracts/app-api.json` (`device_token_pattern`), gegen das Backend UND diese Datei.
 */
val DEVICE_TOKEN = Regex("^[0-9a-f]{64}$")

// Alles, was beim Kopieren aus einer Mail, einem Chat oder einer PDF zwischen
// die Zeichen rutscht: Leerraum, Zeilenumbrüche, geschützte und unsichtbare
// Leerzeichen, das Byte-Order-Mark.
private val PASTE_NOISE = Regex("[\\s\\u00A0\\u200B-\\u200D\\u2060\\uFEFF]")

/**
 * Ein eingefügtes Token in die gespeicherte Form bringen — oder `null`.
 *
 * ⚠️ Ohne diese Prüfung landete ein Zeilenumbruch oder ein Nicht-ASCII-Zeichen
 * im gespeicherten Token, und OkHttp wirft beim Setzen des `Authorization`-
 * Headers eine `IllegalArgumentException` — bei JEDEM Start, weil das Token
 * vor der Probe gespeichert wird. Großbuchstaben werden angenommen und
 * gesenkt (das Backend gibt nur Kleinbuchstaben aus und vergleicht exakt).
 */
fun normalizeDeviceToken(raw: String): String? =
    raw.replace(PASTE_NOISE, "").lowercase().takeIf { DEVICE_TOKEN.matches(it) }
