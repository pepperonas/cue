import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('escapes HTML before rendering (XSS defense)', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes HTML inside markdown constructs', () => {
    const html = renderMarkdown('# <img src=x onerror=alert(1)>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('escapes ampersands without double-escaping', () => {
    expect(renderMarkdown('a & b')).toContain('a &amp; b')
    expect(renderMarkdown('a & b')).not.toContain('&amp;amp;')
  })

  it('renders headings h1-h3', () => {
    expect(renderMarkdown('# Title')).toContain('<h1>Title</h1>')
    expect(renderMarkdown('## Sub')).toContain('<h2>Sub</h2>')
    expect(renderMarkdown('### Deep')).toContain('<h3>Deep</h3>')
  })

  it('renders emphasis and inline code', () => {
    const html = renderMarkdown('**bold** and *soft* and `code`')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>soft</em>')
    expect(html).toContain('<code>code</code>')
  })

  it('keeps fenced code blocks verbatim (no markdown applied inside)', () => {
    const html = renderMarkdown('```\n**not bold** # not a heading\n```')
    expect(html).toContain('<pre><code>')
    expect(html).toContain('**not bold** # not a heading')
    expect(html).not.toContain('<strong>')
  })

  it('escapes HTML inside fenced code blocks', () => {
    const html = renderMarkdown('```\n<script>evil()</script>\n```')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('wraps consecutive list items in a ul', () => {
    const html = renderMarkdown('- one\n- two')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>one</li>')
    expect(html).toContain('<li>two</li>')
  })

  it('splits paragraphs on blank lines and keeps line breaks inside', () => {
    const html = renderMarkdown('first\nsecond\n\nnext para')
    expect(html).toContain('<p>first<br/>second</p>')
    expect(html).toContain('<p>next para</p>')
  })

  it('renders empty input to empty output', () => {
    expect(renderMarkdown('')).toBe('')
  })

  it('keeps "#tag" a word — a heading needs the space after the hashes', () => {
    expect(renderMarkdown('#tag steht im Text')).not.toContain('<h1>')
    expect(renderMarkdown('#### Vier')).toContain('<h4>Vier</h4>')
    expect(renderMarkdown('## Titel ##')).toContain('<h2>Titel</h2>')
  })
})

/** Parse like the browser does; assertions read the DOM, not the string. */
function dom(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  return host
}

describe('renderMarkdown — tables', () => {
  // The table from the bug report: a GFM table with inline code, bold and
  // escaped pipes inside a cell. It used to render as a paragraph of pipes.
  const REPORT = [
    'Beim Auslösen öffnet sich ein kompakter **Song QA / Rating Dialog**.',
    '',
    '| Kategorie | Skala | Worum es geht |',
    '|---|---|---|',
    '| **Song Graph** | 1–5 Sterne `★ ★ ★ ★ ★` | Noten, Rhythmus |',
    '| **Lyrics** | 1–5 Sterne oder `N/A` | Timing |',
    '| **Difficulty Fit** | `Too Easy \\| Ideal \\| Too Hard` (bzw. in der UI), **bewusst keine Sterne** | ob die Stufe passt |',
  ].join('\n')

  it('renders a GFM table with header and body rows', () => {
    const host = dom(renderMarkdown(REPORT))
    const table = host.querySelector('table')!
    expect(table).not.toBeNull()
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual([
      'Kategorie',
      'Skala',
      'Worum es geht',
    ])
    expect(table.querySelectorAll('tbody tr')).toHaveLength(3)
    // The paragraph before the table is still a paragraph of its own.
    expect(host.querySelector('p')?.textContent).toContain('Beim Auslösen')
  })

  it('treats \\| as a literal pipe, also inside inline code', () => {
    const row = dom(renderMarkdown(REPORT)).querySelectorAll('tbody tr')[2]
    const cells = row.querySelectorAll('td')
    expect(cells).toHaveLength(3)
    expect(cells[1].querySelector('code')?.textContent).toBe('Too Easy | Ideal | Too Hard')
    expect(cells[1].querySelector('strong')?.textContent).toBe('bewusst keine Sterne')
    expect(cells[1].textContent).not.toContain('\\')
  })

  it('pads short rows and drops surplus cells to the header width', () => {
    const host = dom(renderMarkdown('| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |'))
    const rows = [...host.querySelectorAll('tbody tr')].map((tr) => tr.querySelectorAll('td').length)
    expect(rows).toEqual([2, 2])
  })

  it('accepts alignment colons and tables without outer pipes', () => {
    const host = dom(renderMarkdown('a | b\n:--|--:\n1 | 2'))
    expect(host.querySelectorAll('th')).toHaveLength(2)
    expect(host.querySelector('td')?.textContent).toBe('1')
  })

  it('does not turn a lone "---" under text into a table', () => {
    const html = renderMarkdown('a | b\n---')
    expect(html).not.toContain('<table>')
  })

  it('ends the table at the first blank line', () => {
    const host = dom(renderMarkdown('| a |\n|---|\n| 1 |\n\nweiter im Text'))
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(host.querySelector('p')?.textContent).toBe('weiter im Text')
  })
})

describe('renderMarkdown — lists', () => {
  it('renders ordered lists and counts from the first number', () => {
    const host = dom(renderMarkdown('3. drei\n4. vier'))
    const items = [...host.querySelectorAll('ol > li')]
    expect(items.map((li) => li.querySelector('span')?.textContent)).toEqual(['3.', '4.'])
    expect(items[0].textContent).toBe('3.drei')
  })

  it('numbers "1. 1. 1." as 1, 2, 3 — like GitHub does', () => {
    const host = dom(renderMarkdown('1. a\n1. b\n1. c'))
    expect([...host.querySelectorAll('ol span')].map((s) => s.textContent)).toEqual(['1.', '2.', '3.'])
  })

  it('nests an indented list inside its parent item', () => {
    const host = dom(renderMarkdown('- oben\n  - drunter\n  - auch\n- wieder oben'))
    const top = host.querySelector('ul')!
    expect(top.children).toHaveLength(2)
    expect(top.children[0].querySelectorAll('ul > li')).toHaveLength(2)
  })

  it('keeps a code block that belongs to a list item inside the item', () => {
    const host = dom(renderMarkdown('1. Schritt\n\n   ```\n   npm test\n   ```\n2. Weiter'))
    const items = host.querySelectorAll('ol > li')
    expect(items).toHaveLength(2)
    expect(items[0].querySelector('pre code')?.textContent).toBe('npm test')
    expect(items[1].querySelector('span')?.textContent).toBe('2.')
  })

  it('renders task list boxes as characters, never as inputs', () => {
    const host = dom(renderMarkdown('- [ ] offen\n- [x] erledigt'))
    expect(host.querySelector('input')).toBeNull()
    expect([...host.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['☐ offen', '☑ erledigt'])
  })

  it('does not start an ordered list inside a sentence', () => {
    const host = dom(renderMarkdown('Das war\n2024. Danach kam mehr'))
    expect(host.querySelector('ol')).toBeNull()
  })

  it('accepts +, * and 1) as markers', () => {
    expect(dom(renderMarkdown('+ a\n+ b')).querySelectorAll('ul > li')).toHaveLength(2)
    expect(dom(renderMarkdown('* a\n* b')).querySelectorAll('ul > li')).toHaveLength(2)
    expect(dom(renderMarkdown('1) a\n2) b')).querySelectorAll('ol > li')).toHaveLength(2)
  })
})

describe('renderMarkdown — other blocks and inline', () => {
  it('drops the language tag of a fence instead of printing it as code', () => {
    const host = dom(renderMarkdown('```ts\nconst a = 1\n```'))
    expect(host.querySelector('pre code')?.textContent).toBe('const a = 1')
  })

  it('accepts tilde fences and longer fences', () => {
    expect(dom(renderMarkdown('~~~\nx\n~~~')).querySelector('pre')?.textContent).toBe('x')
    expect(dom(renderMarkdown('````\n```\ninner\n```\n````')).querySelector('pre')?.textContent).toBe(
      '```\ninner\n```',
    )
  })

  it('does not open a fence for "```inline```" on one line', () => {
    const host = dom(renderMarkdown('```inline``` und weiter\n\nzweiter Absatz'))
    expect(host.querySelector('pre')).toBeNull()
    expect(host.querySelectorAll('p')).toHaveLength(2)
  })

  it('renders blockquotes, rules and strikethrough', () => {
    const host = dom(renderMarkdown('> zitiert **fett**\n> weiter\n\n---\n\n~~weg~~'))
    expect(host.querySelector('blockquote strong')?.textContent).toBe('fett')
    expect(host.querySelector('hr')).not.toBeNull()
    expect(host.querySelector('del')?.textContent).toBe('weg')
  })

  it('leaves snake_case identifiers alone', () => {
    const html = renderMarkdown('edited_at und prompt_optimization_version')
    expect(html).not.toContain('<em>')
    // Only the OPENING-side guard catches this one: the closing underscore is
    // followed by the end of the line, so the closing-side rule lets it pass.
    expect(renderMarkdown('setze foo_bar auf baz_')).not.toContain('<em>')
    expect(renderMarkdown('_betont_ und __stark__')).toContain('<em>betont</em>')
    expect(renderMarkdown('_betont_ und __stark__')).toContain('<strong>stark</strong>')
  })

  it('keeps markdown characters inside inline code literal', () => {
    const host = dom(renderMarkdown('`**nicht fett** und *auch nicht*`'))
    expect(host.querySelector('strong, em')).toBeNull()
    expect(host.querySelector('code')?.textContent).toBe('**nicht fett** und *auch nicht*')
  })

  it('supports double-backtick code spans holding a backtick', () => {
    expect(dom(renderMarkdown('`` a ` b ``')).querySelector('code')?.textContent).toBe('a ` b')
  })

  it('honours backslash escapes', () => {
    const host = dom(renderMarkdown('\\*kein kursiv\\* und \\# kein Titel'))
    expect(host.querySelector('em, h1')).toBeNull()
    expect(host.textContent).toBe('*kein kursiv* und # kein Titel')
  })

  it('shows links as the text that was typed — no anchor, no attribute', () => {
    const host = dom(renderMarkdown('[Doku](https://example.com)'))
    expect(host.querySelector('a')).toBeNull()
    expect(host.textContent).toBe('[Doku](https://example.com)')
  })
})

