package io.celox.cue.core

/**
 * Port von `frontend/src/lib/search-query.ts`. Dieselbe Auslegung wie im Web:
 * `termst` sucht im Prompt und im Projektnamen, `"termst` nur im Projektnamen;
 * das ÖFFNENDE Anführungszeichen entscheidet, das schließende ist optional.
 * Ohne Modellnamen — die App kennt den Modellkatalog nicht.
 */
data class ParsedQuery(val needle: String, val projectsOnly: Boolean)

fun parseQuery(raw: String): ParsedQuery {
    val text = raw.trim()
    val quoted = text.startsWith('"') || text.startsWith('„')
    val inner = if (quoted) text.removePrefix("\"").removePrefix("„").removeSuffix("\"").removeSuffix("“").trim() else text
    return ParsedQuery(needle = inner.lowercase(), projectsOnly = quoted && inner.isNotEmpty())
}

fun promptMatches(p: PromptView, projectName: String, q: ParsedQuery): Boolean {
    if (q.needle.isEmpty()) return true
    val name = projectName.lowercase()
    if (q.projectsOnly) return name.contains(q.needle)
    return "${p.title} ${p.body} ${p.tags}".lowercase().contains(q.needle) || name.contains(q.needle)
}
