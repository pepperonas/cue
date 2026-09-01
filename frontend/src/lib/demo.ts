/**
 * Die Demo: die ECHTE App auf erfundenen Daten im Speicher.
 *
 * Ein Besucher kann cue nicht ausprobieren — die App ist mandantenfähig und
 * ein neues Konto wartet auf Freischaltung. Statt eines zweiten, vereinfachten
 * Nachbaus (der sofort veraltet) beantwortet dieses Modul die Anfragen der
 * echten Oberfläche: gezeigt wird damit immer das, was die App heute wirklich
 * tut, nicht das, woran sich jemand bei der letzten Demo-Pflege erinnert hat.
 *
 * Was geht und was nicht, ist bewusst getrennt:
 *
 *   · **Board, Liste, Detail** — vollständig bedienbar. Anlegen, bearbeiten,
 *     ziehen, Tags, Suche, Zusammenführen, Löschen.
 *   · **Runs, Statistiken, Snippets, Verlauf** — vorbereitete Daten zum
 *     Ansehen. Sie sind ohnehin überwiegend Leseansichten.
 *   · **Alles, was Geld kostet oder eine fremde Maschine anfasst** — KI-
 *     Optimierung starten, einen Run starten, in eine CLI-Sitzung tippen —
 *     antwortet mit einer klaren Absage, die die App als Hinweis anzeigt.
 *     ⚠️ Eine erfundene KI-Antwort wäre schlimmer als keine: sie sähe aus wie
 *     ein Ergebnis und wäre keines.
 *
 * Nichts wird gespeichert; ein Neuladen setzt zurück.
 */
import type {
  Me,
  Optimization,
  Priority,
  Project,
  Prompt,
  Status,
  Tag,
} from './types'

/** Fehler, den die App wie jeden Server-Fehler anzeigt. */
export class DemoRefusal extends Error {
  readonly status = 400
}

const REFUSAL =
  'In der Demo nicht verfügbar — das würde eine echte KI-Anfrage oder einen ' +
  'Lauf auf einer echten Maschine auslösen. Melde dich an, um es zu nutzen.'

export interface DemoState {
  prompts: Prompt[]
  projects: Project[]
  tags: Tag[]
  optimizations: Optimization[]
  nextId: number
}

const NOW = new Date()
const iso = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString()

function prompt(p: Partial<Prompt> & { id: number; title: string; body: string }): Prompt {
  return {
    project_id: null,
    status: 'queued',
    sort_order: p.id,
    tags: '',
    bookmarked: false,
    bookmark_order: 0,
    tested: false,
    priority: 'normal',
    test_closely: false,
    optimized: false,
    optimized_body: null,
    optimized_at: null,
    optimization_model: '',
    optimization_version: 0,
    blocked: false,
    created_at: iso(600),
    updated_at: iso(30),
    edited_at: iso(30),
    ran_at: null,
    attachments: [],
    ...p,
  }
}

/** Der Anfangszustand. Bewusst so gewählt, dass jede Board-Eigenschaft einmal
 *  vorkommt — Priorität, blockiert, getestet, „genau testen", Bookmark, ein
 *  wartender KI-Vorschlag. Wer die Demo öffnet, soll sehen, was es gibt. */
export function seedDemo(): DemoState {
  const projects: Project[] = [
    { id: 1, name: 'cue', color: '#7c5cff', sort_order: 1, created_at: iso(9000), prompt_count: 0 },
    { id: 2, name: 'website', color: '#2ec4b6', sort_order: 2, created_at: iso(8000), prompt_count: 0 },
    { id: 3, name: 'infra', color: '#ff9f1c', sort_order: 3, created_at: iso(7000), prompt_count: 0 },
  ]

  const prompts: Prompt[] = [
    prompt({
      id: 1,
      title: 'Landing Page auf den aktuellen Stand bringen',
      body:
        'Du bist erfahrener Frontend-Entwickler.\n\n' +
        'Bring die Landing Page auf den Stand der App: ergänze die Funktionen, die seit\n' +
        'der letzten Fassung dazugekommen sind, und kürze, was doppelt steht.\n\n' +
        'Ausgabe: die geänderten Dateien mit je einem Satz Begründung.',
      project_id: 1,
      tags: 'documentation, gui',
      priority: 'high',
      sort_order: 1,
    }),
    prompt({
      id: 2,
      title: 'Flaky Test in der Housekeeping-Suite finden',
      body:
        'Ein Test schlägt etwa jeden fünften Lauf fehl, immer derselbe.\n\n' +
        'Finde die Ursache, statt den Test toleranter zu machen. Zeig mir zuerst die\n' +
        'Reproduktion, dann den Fix.',
      project_id: 1,
      tags: 'bugfix, testing',
      priority: 'high',
      sort_order: 2,
    }),
    prompt({
      id: 3,
      title: 'Nächtliche Sicherung auf ein zweites Ziel spiegeln',
      body: 'Die Sicherung liegt auf demselben Host wie die Daten. Plane einen zweiten Ablageort.',
      project_id: 3,
      tags: 'infrastructure',
      sort_order: 3,
      blocked: true,
    }),
    prompt({
      id: 4,
      title: 'Tabellen auf schmalen Bildschirmen lesbar machen',
      body: 'Unter 700 px laufen die Tabellen über. Mach daraus Karten, ohne Inhalt zu verlieren.',
      project_id: 2,
      tags: 'gui, mobile',
      priority: 'low',
      sort_order: 4,
    }),
    prompt({
      id: 5,
      title: 'Import aus der alten Textdatei',
      body:
        'Schreibe einen einmaligen Import: eine .txt mit Prompts, getrennt durch ---,\n' +
        'wird zu einzelnen Einträgen. Leere Abschnitte überspringen.',
      project_id: 1,
      tags: 'feature',
      sort_order: 5,
      bookmarked: true,
      bookmark_order: 1,
    }),
    prompt({
      id: 6,
      title: 'Zugriffsrechte der Endpunkte durchgehen',
      body: 'Geh jede Route durch und prüfe, ob sie auf den Mandanten gefiltert ist.',
      project_id: 1,
      tags: 'security',
      status: 'running' as Status,
      sort_order: 1,
      ran_at: iso(12),
    }),
    prompt({
      id: 7,
      title: 'Footer zeigt die Version',
      body: 'Die Versionsnummer soll dezent im Footer stehen — eine Quelle, keine Kopie.',
      project_id: 1,
      tags: 'gui',
      status: 'done' as Status,
      sort_order: 1,
      tested: false,
      test_closely: true,
      ran_at: iso(90),
    }),
    prompt({
      id: 8,
      title: 'Changelog aus der Datei anzeigen',
      body: 'Der Changelog in der App soll die Datei selbst sein, nicht eine zweite Liste.',
      project_id: 1,
      tags: 'feature, documentation',
      status: 'done' as Status,
      sort_order: 2,
      tested: true,
      ran_at: iso(240),
    }),
    prompt({
      id: 9,
      title: 'Bilder vor dem Hochladen verkleinern',
      body: 'Screenshots sind zu groß. Verkleinere sie im Browser, bevor sie den Server erreichen.',
      project_id: 2,
      tags: 'performance',
      status: 'done' as Status,
      sort_order: 3,
      tested: true,
      ran_at: iso(1400),
    }),
  ]

  const tags: Tag[] = [
    'documentation', 'gui', 'bugfix', 'testing', 'infrastructure',
    'mobile', 'feature', 'security', 'performance',
  ].map((name, i) => ({
    id: i + 1,
    name,
    source: 'user' as const,
    usage_count: prompts.filter((p) => p.tags.split(',').map((t) => t.trim()).includes(name)).length,
    created_at: iso(9000),
    last_used_at: iso(60),
  }))

  // Ein wartender Vorschlag, damit die Diff-Ansicht in der Demo etwas zeigt.
  const optimizations: Optimization[] = [
    {
      id: 1,
      prompt_id: 4,
      batch_id: null,
      version: 1,
      status: 'succeeded',
      provider: 'claude_cli',
      model: 'claude-opus-5',
      meta_prompt_version: 4,
      universal: false,
      decision: 'pending',
      decided_at: null,
      original_text: prompts[3].body,
      previous_text: null,
      optimized_text:
        'Du bist erfahrener Frontend-Entwickler.\n\n' +
        'Unter 700 px laufen die Tabellen horizontal über den Rand.\n\n' +
        'Baue sie dort zu Karten um — eine Karte je Zeile, Spaltenüberschrift als Label.\n' +
        'Kein Inhalt darf dabei verlorengehen.\n\n' +
        'Ausgabe: die geänderten Dateien, dazu ein Satz je Datei.',
      original_title: prompts[3].title,
      original_tags: prompts[3].tags,
      optimized_title: 'Tabellen unter 700 px als Karten ausgeben',
      optimized_tags: 'gui, mobile',
      exit_code: 0,
      duration_ms: 18400,
      cost_usd: 0.42,
      input_tokens: 812,
      output_tokens: 1104,
      error: null,
      created_at: iso(20),
      started_at: iso(20),
      finished_at: iso(19),
    },
  ]
  prompts[3].optimized = true
  prompts[3].optimized_body = optimizations[0].optimized_text
  prompts[3].optimized_at = optimizations[0].finished_at
  prompts[3].optimization_model = 'claude-opus-5'
  prompts[3].optimization_version = 1

  for (const p of projects) p.prompt_count = prompts.filter((x) => x.project_id === p.id).length
  return { prompts, projects, tags, optimizations, nextId: 100 }
}

export const DEMO_ME: Me = {
  authenticated: true,
  approved: true,
  is_admin: false,
  csrf_token: 'demo',
  user: { email: 'demo@cue.celox.io', name: 'Demo-Besuch', picture: '' },
}

// ---------------------------------------------------------------------------
// Der Router
// ---------------------------------------------------------------------------

type Body = Record<string, unknown> | undefined

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v))

/** Momentaufnahme aller Vorschau-Daten, die nur gelesen werden. */
const READ_ONLY: Record<string, unknown> = {
  '/optimizations/config': {
    enabled: true,
    provider: 'claude_cli',
    model: 'claude-opus-5',
    providers: [{ id: 'claude_cli', label: 'Claude Code CLI', description: '', available: true }],
  },
  '/optimizations/batch/active': null,
  '/runs/config': { bases: ['/pfad/zum/projekt'], models: ['opus'], permission_modes: ['default'] },
  '/runs': [],
  '/sessions': [],
  '/snippets': { items: [], total: 0 },
  '/snippets/groups': [],
  '/capture/settings': { token_set: false, project_base: '', capture_base: '' },
  '/sync/settings': { token_set: false, sync_ungrouped: false, last_sync: null },
}

/**
 * Eine Anfrage der App beantworten.
 *
 * Rein bis auf die Mutation von `state` — das ist der Zweck. Wirft
 * `DemoRefusal` für alles, was in einer Demo nicht passieren darf.
 */
export function handleDemoRequest(
  state: DemoState,
  method: string,
  path: string,
  body?: Body,
): unknown {
  const url = path.split('?')[0]
  const query = new URLSearchParams(path.includes('?') ? path.split('?')[1] : '')

  // ---- was in der Demo nicht passieren darf -------------------------------
  const spends =
    (method === 'POST' && (url === '/optimizations' || url === '/optimizations/batch')) ||
    (method === 'POST' && url === '/runs') ||
    (method === 'POST' && /^\/sessions\/[^/]+\/send$/.test(url)) ||
    (method === 'PUT' && url === '/optimizations/key') ||
    url.startsWith('/admin/')
  if (spends) throw new DemoRefusal(REFUSAL)

  // ---- Sitzung ------------------------------------------------------------
  if (url === '/auth/me') return DEMO_ME
  if (url === '/auth/logout') return { ok: true }

  // Der Live-Sync fragt hier; in der Demo ändert nichts von außen etwas.
  if (url === '/changes') return { cursor: 'demo', changed: [] }

  // ---- Projekte -----------------------------------------------------------
  if (url === '/projects') {
    if (method === 'GET') return projectsWithCounts(state)  // baut ohnehin neue Objekte
    if (method === 'POST') {
      const p: Project = {
        id: state.nextId++,
        name: String(body?.name ?? 'Neu'),
        color: String(body?.color ?? '#7c5cff'),
        sort_order: state.projects.length + 1,
        created_at: new Date().toISOString(),
        prompt_count: 0,
      }
      state.projects.push(p)
      return p
    }
  }
  if (url === '/projects/reorder' && method === 'POST') {
    const ids = (body?.ids ?? []) as number[]
    ids.forEach((id, i) => {
      const p = state.projects.find((x) => x.id === id)
      if (p) p.sort_order = i + 1
    })
    return { ok: true }
  }
  const projectId = matchId(url, '/projects/')
  if (projectId !== null) {
    const p = state.projects.find((x) => x.id === projectId)
    if (!p) throw new DemoRefusal('Projekt nicht gefunden')
    if (method === 'PATCH') {
      if (body?.name !== undefined) p.name = String(body.name)
      if (body?.color !== undefined) p.color = String(body.color)
      return p
    }
    if (method === 'DELETE') {
      state.projects = state.projects.filter((x) => x.id !== projectId)
      for (const pr of state.prompts) if (pr.project_id === projectId) pr.project_id = null
      return { ok: true }
    }
  }

  // ---- Prompts ------------------------------------------------------------
  if (url === '/prompts') {
    if (method === 'GET') {
      const q = (query.get('q') ?? '').toLowerCase()
      const hits = q
        ? state.prompts.filter(
            (p) => p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q),
          )
        : state.prompts
      return copies(hits)
    }
    if (method === 'POST') return { ...createPrompt(state, body) }
  }
  if (url === '/prompts/move' && method === 'POST') {
    const ids = (body?.ids ?? []) as number[]
    const status = body?.status as Status | undefined
    for (const id of ids) {
      const p = state.prompts.find((x) => x.id === id)
      if (p && status) applyStatus(p, status)
    }
    placeOnTop(state, ids)
    return { moved: ids.length, skipped: 0 }
  }
  if (url === '/prompts/merge' && method === 'POST') {
    const sources = (body?.source_ids ?? []) as number[]
    const merged = createPrompt(state, body)
    if (body?.originals === 'delete') {
      state.prompts = state.prompts.filter((p) => !sources.includes(p.id))
    } else if (body?.originals === 'archive') {
      for (const p of state.prompts) if (sources.includes(p.id)) p.status = 'archived'
    }
    placeOnTop(state, [merged.id])
    return merged
  }

  const moveMatch = /^\/prompts\/(\d+)\/(move|bookmarks\/move)$/.exec(url)
  if (moveMatch && method === 'POST') {
    const p = state.prompts.find((x) => x.id === Number(moveMatch[1]))
    if (!p) throw new DemoRefusal('Prompt nicht gefunden')
    if (moveMatch[2] === 'move') {
      if (body?.status) applyStatus(p, body.status as Status)
      reposition(state, p, body)
    } else {
      p.bookmark_order = num(body?.before_id ?? p.bookmark_order)
    }
    return p
  }

  const dupMatch = /^\/prompts\/(\d+)\/duplicate$/.exec(url)
  if (dupMatch && method === 'POST') {
    const src = state.prompts.find((x) => x.id === Number(dupMatch[1]))
    if (!src) throw new DemoRefusal('Prompt nicht gefunden')
    const copy: Prompt = {
      ...src,
      id: state.nextId++,
      title: `${src.title} (2)`,
      bookmarked: body?.in_place ? src.bookmarked : false,
      status: body?.in_place ? src.status : 'queued',
      project_id: body?.in_place ? src.project_id : ((body?.project_id as number) ?? null),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      edited_at: new Date().toISOString(),
    }
    state.prompts.push(copy)
    return copy
  }

  const promptId = matchId(url, '/prompts/')
  if (promptId !== null) {
    const p = state.prompts.find((x) => x.id === promptId)
    if (!p) throw new DemoRefusal('Prompt nicht gefunden')
    if (method === 'GET') return { ...p }
    if (method === 'PATCH') return { ...patchPrompt(state, p, body) }
    if (method === 'DELETE') {
      state.prompts = state.prompts.filter((x) => x.id !== promptId)
      return { ok: true }
    }
  }

  // ---- Tags ---------------------------------------------------------------
  if (url === '/tags') {
    if (method === 'GET') return { items: withUsage(state), total: state.tags.length }  // withUsage kopiert
    if (method === 'POST') {
      const t: Tag = {
        id: state.nextId++,
        name: String(body?.name ?? '').trim().toLowerCase(),
        source: 'user',
        usage_count: 0,
        created_at: new Date().toISOString(),
        last_used_at: null,
      }
      state.tags.push(t)
      return t
    }
  }
  const tagUsage = /^\/tags\/(\d+)\/usage$/.exec(url)
  if (tagUsage) {
    const tag = state.tags.find((t) => t.id === Number(tagUsage[1]))
    if (!tag) throw new DemoRefusal('Tag nicht gefunden')
    return { tag, prompts: state.prompts.filter((p) => hasTag(p, tag.name)) }
  }
  const tagId = matchId(url, '/tags/')
  if (tagId !== null) {
    const tag = state.tags.find((t) => t.id === tagId)
    if (!tag) throw new DemoRefusal('Tag nicht gefunden')
    if (method === 'PATCH') {
      const to = String(body?.name ?? tag.name).trim().toLowerCase()
      for (const p of state.prompts) p.tags = renameTag(p.tags, tag.name, to)
      tag.name = to
      return { tag, merged: false, prompts_updated: 0 }
    }
    if (method === 'DELETE') {
      for (const p of state.prompts) p.tags = renameTag(p.tags, tag.name, '')
      state.tags = state.tags.filter((t) => t.id !== tagId)
      return { removed: 1, prompts_updated: 0 }
    }
  }

  // ---- Optimierungs-Historie (lesen erlaubt) ------------------------------
  if (url === '/optimizations' && method === 'GET') {
    const pid = query.get('prompt_id')
    return copies(
      pid ? state.optimizations.filter((o) => o.prompt_id === Number(pid)) : state.optimizations,
    )
  }
  const optDecision = /^\/optimizations\/(\d+)\/(apply|discard)$/.exec(url)
  if (optDecision && method === 'POST') {
    // Übernehmen darf man den vorbereiteten Vorschlag — das kostet nichts und
    // ist der interessanteste Teil der Funktion.
    const o = state.optimizations.find((x) => x.id === Number(optDecision[1]))
    const p = o && state.prompts.find((x) => x.id === o.prompt_id)
    if (!o || !p) throw new DemoRefusal('Optimierung nicht gefunden')
    o.decision = optDecision[2] === 'apply' ? 'applied' : 'discarded'
    o.decided_at = new Date().toISOString()
    if (optDecision[2] === 'apply') {
      p.body = o.optimized_text ?? p.body
      if (o.optimized_title) p.title = o.optimized_title
      if (o.optimized_tags) p.tags = o.optimized_tags
    }
    p.optimized = false
    p.optimized_body = null
    return { optimization: o, prompt: p }
  }

  if (url in READ_ONLY && method === 'GET') return READ_ONLY[url]
  if (url === '/optimizations/key' && method === 'GET') {
    return { key_set: false, key_tail: '', model: '', price_state: '', models: [] }
  }

  // Alles Übrige: ehrlich absagen statt still etwas Falsches liefern.
  throw new DemoRefusal(
    `In der Demo nicht verfügbar (${method} ${url}). Melde dich an, um alles zu nutzen.`,
  )
}

// ---- Helfer ---------------------------------------------------------------

/**
 * Kopien herausgeben, niemals die eigenen Objekte.
 *
 * ⚠️ Der Grund ist konkret: die App arbeitet mit optimistischen Aktualisierungen
 * und schreibt dafür in ihren Query-Zwischenspeicher. Gab dieser Router das
 * interne Array zurück, war der Zwischenspeicher **dasselbe Array** — ein
 * angelegter Prompt landete einmal hier und einmal durch die optimistische
 * Einfügung darin, und im Board standen zwei Karten mit derselben id (live
 * gesehen, samt React-Warnung „two children with the same key").
 */
function copies<T>(items: T[]): T[] {
  return items.map((x) => ({ ...x }))
}

function matchId(url: string, prefix: string): number | null {
  if (!url.startsWith(prefix)) return null
  const rest = url.slice(prefix.length)
  return /^\d+$/.test(rest) ? Number(rest) : null
}

function hasTag(p: Prompt, name: string): boolean {
  return p.tags.split(',').map((t) => t.trim().toLowerCase()).includes(name.toLowerCase())
}

function renameTag(tags: string, from: string, to: string): string {
  const names = tags.split(',').map((t) => t.trim()).filter(Boolean)
  const out: string[] = []
  for (const n of names) {
    const next = n.toLowerCase() === from.toLowerCase() ? to : n
    if (next && !out.some((x) => x.toLowerCase() === next.toLowerCase())) out.push(next)
  }
  return out.join(', ')
}

function withUsage(state: DemoState): Tag[] {
  return state.tags.map((t) => ({
    ...t,
    usage_count: state.prompts.filter((p) => hasTag(p, t.name)).length,
  }))
}

function projectsWithCounts(state: DemoState): Project[] {
  return state.projects
    .map((p) => ({
      ...p,
      prompt_count: state.prompts.filter((x) => x.project_id === p.id).length,
    }))
    .sort((a, b) => a.sort_order - b.sort_order)
}

/** Statuswechsel mit denselben Nebenwirkungen wie im Server. */
function applyStatus(p: Prompt, status: Status): void {
  if (status !== 'done') p.tested = false
  if (status !== 'queued') p.blocked = false
  if ((status === 'running' || status === 'done') && !p.ran_at) {
    p.ran_at = new Date().toISOString()
  }
  p.status = status
}

function placeOnTop(state: DemoState, ids: number[]): void {
  const min = Math.min(...state.prompts.map((p) => p.sort_order), 0)
  ids.forEach((id, i) => {
    const p = state.prompts.find((x) => x.id === id)
    if (p) p.sort_order = min - ids.length + i
  })
}

/** Verankert an einem Nachbarn einsortieren, wie `POST /prompts/{id}/move`. */
function reposition(state: DemoState, p: Prompt, body: Body): void {
  const column = state.prompts
    .filter((x) => x.status === p.status && x.id !== p.id)
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
  let at = column.length
  if (body?.top) at = 0
  else if (body?.before_id) at = Math.max(0, column.findIndex((x) => x.id === num(body.before_id)))
  else if (body?.after_id) at = column.findIndex((x) => x.id === num(body.after_id)) + 1
  column.splice(at, 0, p)
  column.forEach((x, i) => (x.sort_order = i + 1))
}

function createPrompt(state: DemoState, body: Body): Prompt {
  const text = String(body?.body ?? '')
  const title =
    String(body?.title ?? '').trim() ||
    text.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').trim() ||
    'Ohne Titel'
  const p = prompt({
    id: state.nextId++,
    title,
    body: text,
    project_id: (body?.project_id as number | null) ?? null,
    status: (body?.status as Status) ?? 'queued',
    tags: String(body?.tags ?? ''),
    bookmarked: Boolean(body?.bookmarked),
    priority: (body?.priority as Priority) ?? 'normal',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    edited_at: new Date().toISOString(),
    sort_order: 0,
  })
  state.prompts.push(p)
  placeOnTop(state, [p.id])
  registerTags(state, p.tags)
  return p
}

function patchPrompt(state: DemoState, p: Prompt, body: Body): Prompt {
  if (body?.status !== undefined) applyStatus(p, body.status as Status)
  if (body?.title !== undefined) p.title = String(body.title)
  if (body?.body !== undefined) p.body = String(body.body)
  if (body?.project_id !== undefined) p.project_id = body.project_id as number | null
  if (body?.tags !== undefined) {
    p.tags = String(body.tags)
    registerTags(state, p.tags)
  }
  if (body?.bookmarked !== undefined) p.bookmarked = Boolean(body.bookmarked)
  if (body?.blocked !== undefined) p.blocked = Boolean(body.blocked)
  if (body?.priority !== undefined) p.priority = body.priority as Priority
  if (body?.test_closely !== undefined) p.test_closely = Boolean(body.test_closely)
  if (body?.tested !== undefined) {
    // Dieselbe Zusicherung wie im Server: „getestet" gibt es nur auf done.
    if (body.tested && p.status !== 'done') {
      throw new DemoRefusal('Nur erledigte Prompts können als getestet markiert werden')
    }
    p.tested = Boolean(body.tested)
  }
  p.updated_at = new Date().toISOString()
  p.edited_at = new Date().toISOString()
  return p
}

function registerTags(state: DemoState, tags: string): void {
  for (const name of tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)) {
    if (!state.tags.some((t) => t.name.toLowerCase() === name)) {
      state.tags.push({
        id: state.nextId++,
        name,
        source: 'user',
        usage_count: 1,
        created_at: new Date().toISOString(),
        last_used_at: new Date().toISOString(),
      })
    }
  }
}
