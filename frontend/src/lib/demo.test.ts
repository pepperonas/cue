import { beforeEach, describe, expect, it } from 'vitest'
import { DemoRefusal, handleDemoRequest, seedDemo, type DemoState } from './demo'
import type { Prompt } from './types'

let state: DemoState
beforeEach(() => {
  state = seedDemo()
})

const call = (method: string, path: string, body?: Record<string, unknown>) =>
  handleDemoRequest(state, method, path, body)

describe('seedDemo', () => {
  it('shows every board property at least once', () => {
    // Wer die Demo öffnet, soll sehen, was es gibt — sonst wirkt das Board
    // ärmer als die App.
    const p = state.prompts
    expect(p.some((x) => x.priority === 'high')).toBe(true)
    expect(p.some((x) => x.priority === 'low')).toBe(true)
    expect(p.some((x) => x.blocked)).toBe(true)
    expect(p.some((x) => x.tested)).toBe(true)
    expect(p.some((x) => x.test_closely)).toBe(true)
    expect(p.some((x) => x.bookmarked)).toBe(true)
    expect(p.some((x) => x.optimized)).toBe(true)
    expect(new Set(p.map((x) => x.status))).toEqual(new Set(['queued', 'running', 'done']))
  })

  it('starts fresh every time — nothing survives a reload', () => {
    const a = seedDemo()
    a.prompts.push({ id: 999 } as Prompt)
    expect(seedDemo().prompts.some((p) => p.id === 999)).toBe(false)
  })
})

describe('the session it pretends to have', () => {
  it('answers /auth/me as an approved user', () => {
    // Ohne das liefe die App gegen ihre eigene Anmeldeschranke, und die Demo
    // zeigte die Landing Page statt des Boards.
    expect(call('GET', '/auth/me')).toMatchObject({ authenticated: true, approved: true })
  })

  it('is not an admin', () => {
    // Nutzerverwaltung in einer Demo wäre sinnlos und verwirrend.
    expect(call('GET', '/auth/me')).toMatchObject({ is_admin: false })
  })

  it('tells the live-sync that nothing changed', () => {
    // Die Schleife fragt hier laufend; in der Demo ändert nichts von außen
    // etwas, und eine Absage würde sie in den Fehler-Backoff schicken.
    expect(call('GET', '/changes?since=x&wait=25')).toEqual({ cursor: 'demo', changed: [] })
  })
})

describe('what the demo refuses', () => {
  it.each([
    ['POST', '/optimizations'],
    ['POST', '/optimizations/batch'],
    ['POST', '/runs'],
    ['POST', '/sessions/abc/send'],
    ['PUT', '/optimizations/key'],
    ['GET', '/admin/users'],
  ])('refuses %s %s with the reason, not just with an error', (method, path) => {
    // ⚠️ Alles, was echtes Geld kostet oder eine fremde Maschine anfasst. Eine
    // erfundene KI-Antwort wäre schlimmer als keine: sie sähe aus wie ein
    // Ergebnis und wäre keines.
    //
    // ⚠️ Geprüft wird die BEGRÜNDUNG, nicht nur „wirft". Ohne die Wache fielen
    // dieselben Pfade in die Auffang-Absage am Ende und der Test bliebe grün —
    // genau so beim Mutieren passiert. Die Auffang-Meldung nennt den Pfad, die
    // gezielte nennt den Grund.
    expect(() => call(method, path, {})).toThrow(/echte KI-Anfrage|echten Maschine/)
  })

  it('says why, in words the app can show', () => {
    try {
      call('POST', '/runs', {})
      expect.unreachable()
    } catch (e) {
      expect((e as Error).message).toMatch(/Demo/)
      // Nicht nur „geht nicht", sondern auch, was man stattdessen tun kann.
      expect((e as Error).message).toMatch(/[Mm]elde dich an|[Aa]nmelden/)
    }
  })

  it('refuses an endpoint it does not know rather than answering wrongly', () => {
    expect(() => call('GET', '/etwas/das/es/nicht/gibt')).toThrow(DemoRefusal)
  })
})

describe('prompts', () => {
  it('creates one and puts it on top of the queue', () => {
    // ⚠️ Nicht „kleiner als das bisherige Minimum" prüfen: ein nicht gesetzter
    // sort_order ist 0 und erfüllt das zufällig. Geprüft wird die Ordnung
    // selbst — und dass ein zweites Anlegen wieder darüber landet.
    const first = call('POST', '/prompts', { body: 'A', title: 'Erster' }) as Prompt
    const second = call('POST', '/prompts', { body: 'B', title: 'Zweiter' }) as Prompt
    const queue = state.prompts
      .filter((p) => p.status === 'queued')
      .sort((a, b) => a.sort_order - b.sort_order)
    expect(queue[0].id).toBe(second.id)
    expect(queue[1].id).toBe(first.id)
  })

  it('derives a missing title from the first non-blank line', () => {
    const p = call('POST', '/prompts', { body: '\n\n# Aus der Zeile\nRest' }) as Prompt
    expect(p.title).toBe('Aus der Zeile')
  })

  it('registers tags that did not exist yet', () => {
    call('POST', '/prompts', { body: 'x', tags: 'frischestag' })
    const list = call('GET', '/tags') as { items: { name: string }[] }
    expect(list.items.map((t) => t.name)).toContain('frischestag')
  })

  it('clears "tested" when a prompt leaves done — like the server', () => {
    const done = state.prompts.find((p) => p.tested)!
    call('PATCH', `/prompts/${done.id}`, { status: 'queued' })
    expect(state.prompts.find((p) => p.id === done.id)!.tested).toBe(false)
  })

  it('refuses "tested" on something that is not done — like the server', () => {
    const queued = state.prompts.find((p) => p.status === 'queued')!
    expect(() => call('PATCH', `/prompts/${queued.id}`, { tested: true })).toThrow(DemoRefusal)
  })

  it('unblocks a prompt that leaves the queue — like the server', () => {
    const blocked = state.prompts.find((p) => p.blocked)!
    call('PATCH', `/prompts/${blocked.id}`, { status: 'running' })
    expect(state.prompts.find((p) => p.id === blocked.id)!.blocked).toBe(false)
  })

  it('deletes', () => {
    const id = state.prompts[0].id
    call('DELETE', `/prompts/${id}`)
    expect(state.prompts.some((p) => p.id === id)).toBe(false)
  })

  it('searches title and body', () => {
    const hits = call('GET', '/prompts?q=changelog') as Prompt[]
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.length).toBeLessThan(state.prompts.length)
  })
})

describe('moving', () => {
  it('anchors before a neighbour and renumbers the column', () => {
    const queue = state.prompts
      .filter((p) => p.status === 'queued')
      .sort((a, b) => a.sort_order - b.sort_order)
    const last = queue[queue.length - 1]
    const first = queue[0]
    call('POST', `/prompts/${last.id}/move`, { before_id: first.id })
    const after = state.prompts
      .filter((p) => p.status === 'queued')
      .sort((a, b) => a.sort_order - b.sort_order)
    expect(after[0].id).toBe(last.id)
    // Lückenlos durchnummeriert, wie der Server es tut.
    expect(after.map((p) => p.sort_order)).toEqual(after.map((_, i) => i + 1))
  })

  it('takes a whole selection across in one call', () => {
    const ids = state.prompts.filter((p) => p.status === 'queued').slice(0, 2).map((p) => p.id)
    call('POST', '/prompts/move', { ids, status: 'done' })
    for (const id of ids) {
      expect(state.prompts.find((p) => p.id === id)!.status).toBe('done')
    }
  })

  it('stamps ran_at the first time something starts running', () => {
    const p = state.prompts.find((x) => x.status === 'queued' && !x.ran_at)!
    call('PATCH', `/prompts/${p.id}`, { status: 'running' })
    expect(state.prompts.find((x) => x.id === p.id)!.ran_at).toBeTruthy()
  })
})

describe('the waiting AI proposal', () => {
  it('is offered for exactly one prompt', () => {
    expect(state.prompts.filter((p) => p.optimized)).toHaveLength(1)
  })

  it('can be applied — that costs nothing and is the interesting part', () => {
    const opt = state.optimizations[0]
    const res = call('POST', `/optimizations/${opt.id}/apply`) as { prompt: Prompt }
    expect(res.prompt.body).toBe(opt.optimized_text)
    expect(res.prompt.title).toBe(opt.optimized_title)
    expect(res.prompt.tags).toBe(opt.optimized_tags)
    expect(res.prompt.optimized).toBe(false)
  })

  it('can be discarded without touching the prompt', () => {
    const opt = state.optimizations[0]
    const before = state.prompts.find((p) => p.id === opt.prompt_id)!.body
    call('POST', `/optimizations/${opt.id}/discard`)
    expect(state.prompts.find((p) => p.id === opt.prompt_id)!.body).toBe(before)
  })
})

describe('Zusammenführen auftrennen', () => {
  it('bringt gelöschte Quellen zurück', () => {
    const a = state.prompts[0]
    const b = state.prompts[1]
    const merged = call('POST', '/prompts/merge', {
      source_ids: [a.id, b.id],
      body: 'zusammen',
      originals: 'delete',
    }) as Prompt
    expect(merged.merged_from).toBe(2)
    expect(state.prompts.some((p) => p.id === a.id)).toBe(false)

    const zurueck = call('POST', `/prompts/${merged.id}/unmerge`, { merged: 'delete' }) as Prompt[]
    expect(zurueck.map((p) => p.body)).toEqual([a.body, b.body])
    expect(state.prompts.some((p) => p.id === merged.id)).toBe(false)
  })

  it('setzt eine noch lebende Quelle zurück, statt sie zu doppeln', () => {
    const [a, b] = state.prompts
    const vorher = state.prompts.length
    const merged = call('POST', '/prompts/merge', {
      source_ids: [a.id, b.id],
      body: 'zusammen',
      originals: 'archive',
    }) as Prompt
    expect(state.prompts.find((p) => p.id === a.id)?.status).toBe('archived')

    call('POST', `/prompts/${merged.id}/unmerge`, { merged: 'delete' })
    expect(state.prompts.find((p) => p.id === a.id)?.status).toBe(a.status)
    expect(state.prompts.length).toBe(vorher)   // keine Doppel
  })

  it('weist einen Prompt ab, der aus keinem Zusammenführen stammt', () => {
    expect(() => call('POST', `/prompts/${state.prompts[0].id}/unmerge`, {})).toThrow()
  })
})

describe('die Demo hält sich an die Form, die der Client erwartet', () => {
  it('liefert Snippets als Liste, nicht als Umschlag', () => {
    // `snippetsApi.list` verspricht `Snippet[]`. Mit `{items,total}` warf der
    // Snippets-Reiter „snippets is not iterable" und blieb leer.
    expect(Array.isArray(call('GET', '/snippets'))).toBe(true)
    expect(Array.isArray(call('GET', '/snippets/groups'))).toBe(true)
  })
})

describe('projects and tags', () => {
  it('counts the prompts of each project', () => {
    const projects = call('GET', '/projects') as { id: number; prompt_count: number }[]
    const cue = projects.find((p) => p.id === 1)!
    expect(cue.prompt_count).toBe(state.prompts.filter((p) => p.project_id === 1).length)
  })

  it('persists the manually dragged project priority', () => {
    // The board sends the whole invisible priority list. Returning the same
    // order as the API makes a quiet badge stay where it was dropped after a
    // query refresh.
    const result = call('POST', '/projects/reorder', {
      items: [
        { id: 3, sort_order: 1 },
        { id: 1, sort_order: 2 },
        { id: 2, sort_order: 3 },
      ],
    }) as { id: number }[]
    expect(result.map((p) => p.id)).toEqual([3, 1, 2])
    expect((call('GET', '/projects') as { id: number }[]).map((p) => p.id)).toEqual([3, 1, 2])
  })

  it('detaches prompts instead of deleting them with the project', () => {
    // ⚠️ „Kein Prompt hat mehr diese Projekt-ID" gilt auch, wenn man sie alle
    // gelöscht hat — der Test muss die ANZAHL festhalten. Beim Mutieren blieb
    // die erste Fassung grün, während die Prompts verschwanden.
    const total = state.prompts.length
    const affected = state.prompts.filter((p) => p.project_id === 1).length
    expect(affected).toBeGreaterThan(0)
    call('DELETE', '/projects/1')
    expect(state.prompts).toHaveLength(total)
    expect(state.prompts.filter((p) => p.project_id === null).length).toBeGreaterThanOrEqual(
      affected,
    )
  })

  it('renames a tag everywhere it is used', () => {
    const tag = state.tags.find((t) => t.name === 'gui')!
    call('PATCH', `/tags/${tag.id}`, { name: 'oberflaeche' })
    expect(state.prompts.some((p) => p.tags.includes('gui'))).toBe(false)
    expect(state.prompts.some((p) => p.tags.includes('oberflaeche'))).toBe(true)
  })

  it('removes a deleted tag from every prompt', () => {
    const tag = state.tags.find((t) => t.name === 'gui')!
    call('DELETE', `/tags/${tag.id}`)
    expect(state.prompts.some((p) => p.tags.split(',').some((t) => t.trim() === 'gui'))).toBe(false)
  })
})

describe('isolation from the app', () => {
  it('never hands out its own arrays or objects', () => {
    // ⚠️ Die App aktualisiert optimistisch und schreibt dafür in ihren
    // Query-Zwischenspeicher. Gab dieser Router das interne Array zurück, war
    // der Zwischenspeicher DASSELBE Array: ein angelegter Prompt landete
    // doppelt im Board (live gesehen, mit React-Warnung über doppelte Keys).
    const list = call('GET', '/prompts') as Prompt[]
    expect(list).not.toBe(state.prompts)
    expect(list[0]).not.toBe(state.prompts[0])
  })

  it('survives the app mutating what it got', () => {
    const list = call('GET', '/prompts') as Prompt[]
    const n = state.prompts.length
    list.push({ id: -1 } as Prompt)
    list[0].title = 'von außen verändert'
    expect(state.prompts).toHaveLength(n)
    expect(state.prompts[0].title).not.toBe('von außen verändert')
  })

  it('copies the single prompt and the optimization history too', () => {
    const id = state.prompts[0].id
    expect(call('GET', `/prompts/${id}`)).not.toBe(state.prompts[0])
    const hist = call('GET', '/optimizations?prompt_id=4') as unknown[]
    expect(hist[0]).not.toBe(state.optimizations[0])
  })
})

describe('Projekt-Analyse in der Demo', () => {
  it('lehnt das Anstoßen ab — das kostet Geld', () => {
    const state = seedDemo()
    expect(() => handleDemoRequest(state, 'POST', '/analyses', { project_id: 1 })).toThrow(
      DemoRefusal,
    )
  })

  it('zeigt den vorbereiteten Vorschlag', () => {
    const state = seedDemo()
    const liste = handleDemoRequest(state, 'GET', '/analyses?project_id=1') as unknown[]
    expect(liste).toHaveLength(1)
    const eine = handleDemoRequest(state, 'GET', '/analyses/1') as {
      result: { reihenfolge: { prompt_id: number }[] }
    }
    expect(eine.result.reihenfolge.map((s) => s.prompt_id)).toEqual([2, 1, 10, 5])
  })

  it('übernimmt die Reihenfolge auf den Plätzen, die das Projekt schon hält', () => {
    const state = seedDemo()
    const fremd = state.prompts
      .filter((p) => p.status === 'queued' && p.project_id !== 1)
      .map((p) => [p.id, p.sort_order] as const)

    const r = handleDemoRequest(state, 'POST', '/analyses/1/apply') as { geaendert: number }
    expect(r.geaendert).toBeGreaterThan(0)

    // Fremde Projekte in derselben Spalte bleiben unangetastet.
    for (const [id, platz] of fremd) {
      expect(state.prompts.find((p) => p.id === id)!.sort_order).toBe(platz)
    }
    // Und die eigene Folge stimmt.
    const eigene = state.prompts
      .filter((p) => p.status === 'queued' && p.project_id === 1)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((p) => p.id)
    expect(eigene).toEqual([2, 1, 10, 5])
  })

  it('schreibt die vorgeschlagenen Prioritäten mit', () => {
    const state = seedDemo()
    handleDemoRequest(state, 'POST', '/analyses/1/apply')
    expect(state.prompts.find((p) => p.id === 2)!.priority).toBe('high')
    expect(state.prompts.find((p) => p.id === 5)!.priority).toBe('low')
    // Prompt 1 steht schon auf „hoch" — der Vorschlag nennt dafür KEINE
    // Priorität und darf sie deshalb auch nicht anfassen.
    expect(state.prompts.find((p) => p.id === 1)!.priority).toBe('high')
    expect(state.prompts.find((p) => p.id === 10)!.priority).toBe('normal')
  })

  it('ändert beim Verwerfen nichts', () => {
    const state = seedDemo()
    const vorher = state.prompts.map((p) => [p.id, p.sort_order, p.priority] as const)
    const r = handleDemoRequest(state, 'POST', '/analyses/1/discard') as { geaendert: number }
    expect(r.geaendert).toBe(0)
    expect(state.prompts.map((p) => [p.id, p.sort_order, p.priority] as const)).toEqual(vorher)
  })
})
