/**
 * Der Changelog der App — aus derselben Datei, die das Repository pflegt.
 *
 * `CHANGELOG.md` wird beim Bauen roh eingebettet und hier geparst; es gibt
 * bewusst **keine zweite, von Hand gepflegte Fassung** in der Oberfläche.
 * Dasselbe Vorgehen wie im About-Bildschirm von BeatByte (`include_str!`), und
 * aus demselben Grund: Die Hausregel zwingt jede sichtbare Änderung ohnehin in
 * diese Datei, also erscheint der nächste Eintrag hier, ohne dass jemand diesen
 * Bereich anfasst.
 *
 * Der Parser ist rein und getestet. Das Laden der 85 kB großen Datei ist
 * bewusst NICHT hier, sondern ein dynamischer Import im Aufrufer — der
 * Changelog ist zugeklappt, bis jemand ihn öffnet, und darf das erste Rendern
 * der App nicht belasten.
 */

/** Ein Versionsabschnitt, so wie er in der Datei steht. */
export interface ChangelogEntry {
  /** Die Version ohne Klammern, z. B. `0.60.0`. */
  version: string
  /** Das Datum, wie es dasteht (`2026-09-01`), oder leer. */
  date: string
  /** Die Einträge, nach Änderungsart gruppiert — in Dateireihenfolge. */
  groups: ChangelogGroup[]
}

export interface ChangelogGroup {
  /** `Added`, `Fixed`, … — wie in der Datei geschrieben. */
  kind: string
  /** Die Punkte dieser Gruppe, Listenzeichen entfernt, Zeilen zusammengezogen. */
  items: string[]
}

const VERSION_HEAD = /^## \[(\d+\.\d+\.\d+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/
const GROUP_HEAD = /^### (.+?)\s*$/
const BULLET = /^[-*]\s+(.*)$/

/**
 * Ein Keep-a-Changelog-Dokument in Einträge zerlegen, neueste zuerst.
 *
 * Die Reihenfolge ist die der Datei — die ist bereits testgepinnt
 * (`test_changelog_versions_are_unique_and_ordered_newest_first`), also wird
 * hier nicht noch einmal sortiert: zwei Stellen, die dieselbe Ordnung
 * herstellen, sind zwei Stellen, die sich widersprechen können.
 */
export function parseChangelog(text: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  let entry: ChangelogEntry | null = null
  let group: ChangelogGroup | null = null

  for (const raw of (text ?? '').split('\n')) {
    const line = raw.trimEnd()

    const head = VERSION_HEAD.exec(line)
    if (head) {
      entry = { version: head[1], date: head[2] ?? '', groups: [] }
      entries.push(entry)
      group = null
      continue
    }
    // Alles vor der ersten Versionsüberschrift ist Vorspann (Titel, Hinweis
    // auf Keep a Changelog) und gehört in keinen Eintrag.
    if (!entry) continue

    const groupHead = GROUP_HEAD.exec(line)
    if (groupHead) {
      group = { kind: groupHead[1], items: [] }
      entry.groups.push(group)
      continue
    }

    const bullet = BULLET.exec(line.trim())
    if (bullet) {
      // Ein Eintrag ohne `###`-Überschrift ist selten, aber möglich; er landet
      // in einer namenlosen Gruppe, statt verloren zu gehen.
      if (!group) {
        group = { kind: '', items: [] }
        entry.groups.push(group)
      }
      group.items.push(bullet[1].trim())
      continue
    }

    // Fortsetzungszeile eines umbrochenen Punktes: anhängen statt verwerfen.
    // Ohne das zerfiele jeder mehrzeilige Eintrag — und in dieser Datei sind
    // fast alle mehrzeilig.
    if (line.trim() && group && group.items.length > 0) {
      group.items[group.items.length - 1] += ` ${line.trim()}`
    }
  }
  return entries
}

/** Der Eintrag zu einer Version, oder `undefined`. */
export function entryFor(
  entries: ChangelogEntry[],
  version: string,
): ChangelogEntry | undefined {
  return entries.find((e) => e.version === version)
}
