import { describe, expect, it } from 'vitest'
import { renderInlineMarkdown, renderMarkdown } from './markdown'

/**
 * The renderer's output goes straight into `dangerouslySetInnerHTML` with no
 * sanitiser behind it — escaping IS the whole defence, so it is worth pushing
 * on properly. These tests push on the PROPERTY rather than on individual
 * strings: whatever the input, the output must not be able to execute
 * anything or reach out to the network.
 *
 * Kept apart from `markdown.test.ts`, which covers what the renderer is for;
 * this one covers what it must never do.
 */

// The delimiter fenced blocks are parked under while the markdown rules run.
// Spelled as an escape on purpose: a literal control character in a source
// file is invisible to every reader, and it makes grep treat the file as
// binary and skip it.
const NUL = '\u0000'

// [name, input, the text that must still be READABLE afterwards]. The third
// column matters as much as the safety: a prompt that discusses an XSS payload
// has to survive being previewed, so nothing may be silently swallowed either.
const VECTORS: [string, string, string][] = [
  ['plain script', '<script>alert(1)</script>', 'alert(1)'],
  ['uppercase tag', '<SCRIPT>alert(1)</SCRIPT>', 'alert(1)'],
  ['image handler', '<img src=x onerror=alert(1)>', 'onerror=alert(1)'],
  ['svg handler', '<svg/onload=alert(1)>', 'onload=alert(1)'],
  ['iframe', '<iframe src="javascript:alert(1)"></iframe>', 'javascript:alert(1)'],
  ['anchor', '<a href="javascript:alert(1)">klick</a>', 'javascript:alert(1)'],
  ['body handler', '<body onload=alert(1)>', 'onload=alert(1)'],
  ['style block', '<style>*{background:url(evil)}</style>', 'url(evil)'],
  ['unclosed tag', '<img src=x onerror=alert(1)', 'onerror=alert(1)'],
  ['entity-encoded', '&lt;script&gt;alert(1)&lt;/script&gt;', 'alert(1)'],
  ['double-encoded', '&amp;lt;script&amp;gt;', 'script'],
  ['inside a heading', '# <img src=x onerror=alert(1)>', 'onerror=alert(1)'],
  ['inside emphasis', '**<img src=x onerror=alert(1)>**', 'onerror=alert(1)'],
  ['inside inline code', '`<img src=x onerror=alert(1)>`', 'onerror=alert(1)'],
  ['inside a fence', '```\n<img src=x onerror=alert(1)>\n```', 'onerror=alert(1)'],
  ['inside a list item', '- <img src=x onerror=alert(1)>', 'onerror=alert(1)'],
  ['split across lines', '<img\nsrc=x\nonerror=alert(1)>', 'onerror=alert(1)'],
  ['carrying a null byte', `<img ${NUL} src=x onerror=alert(1)>`, 'onerror=alert(1)'],
  ['mixed with markdown', '## **bold** <script>x</script> `code`', 'script'],
]


// The complete set of tags this renderer is allowed to produce.
const ALLOWED = new Set(['p', 'br', 'h1', 'h2', 'h3', 'strong', 'em', 'code', 'pre', 'ul', 'li'])

/**
 * Parse the output the way the browser will and return every element in it.
 *
 * Deliberately not a regex over the string: escaped, inert text legitimately
 * CONTAINS things like `onerror=` and `javascript:` — that is the whole point
 * of escaping, the user gets to see what they typed. The question is never
 * "does this substring appear" but "what does the DOM end up holding", and
 * only a parser answers that one.
 */
function elementsIn(html: string): Element[] {
  const template = document.createElement('template')
  template.innerHTML = html
  return [...template.content.querySelectorAll('*')]
}

describe('renderMarkdown cannot be talked into emitting live HTML', () => {
  it.each(VECTORS)('builds nothing but its own tags for %s', (_name, input) => {
    const tags = elementsIn(renderMarkdown(input)).map((el) => el.tagName.toLowerCase())
    expect(tags.filter((tag) => !ALLOWED.has(tag))).toEqual([])
  })

  it.each(VECTORS)('builds no element carrying any attribute for %s', (_name, input) => {
    // The subset has neither links nor images, so NOTHING it produces carries
    // an attribute — which is what makes leaving quotes unescaped safe. That
    // assumption would break silently the day someone adds link support, so it
    // is pinned here instead of left to be remembered.
    const withAttributes = elementsIn(renderMarkdown(input))
      .filter((el) => el.attributes.length > 0)
      .map((el) => el.outerHTML)
    expect(withAttributes).toEqual([])
  })

  it.each(VECTORS)('keeps the payload readable as text for %s', (_name, input, visible) => {
    const text = elementsIn(renderMarkdown(input))
      .map((el) => el.textContent ?? '')
      .join('')
    expect(text.replace(/\s+/g, ' ')).toContain(visible)
  })

  it('escapes angle brackets instead of stripping them', () => {
    // Stripping would silently eat text: a prompt about generics or shell
    // redirection has to survive being previewed.
    expect(renderMarkdown('a < b > c')).toContain('a &lt; b &gt; c')
    expect(renderMarkdown('Vec<String>')).toContain('Vec&lt;String&gt;')
    expect(renderMarkdown('cmd 2>&1')).toContain('2&gt;&amp;1')
  })

  it('escapes the ampersand first, so nothing can be smuggled through encoding', () => {
    // If `<` were escaped before `&`, then `&lt;script&gt;` typed by the user
    // would come out as a real tag after the browser decodes it once.
    expect(renderMarkdown('&lt;script&gt;')).toContain('&amp;lt;script&amp;gt;')
  })
})

describe('renderMarkdown survives malformed input', () => {
  const MALFORMED: [string, string][] = [
    ['unclosed fence', '```\nlet x = 1'],
    ['lone backtick', '`'],
    ['unbalanced emphasis', '**bold'],
    ['unbalanced italics', '*a ** b *'],
    ['empty fence', '``````'],
    ['fence inside a fence', '```\n```\n```'],
    ['heading with nothing after it', '#'],
    ['list marker with nothing after it', '-'],
    ['only blank lines', '\n\n\n\n'],
    ['only whitespace', '   \t  '],
    ['windows line endings', 'a\r\n\r\nb'],
    ['a very long single line', 'x'.repeat(20_000)],
    ['many list items', Array.from({ length: 500 }, (_, i) => `- item ${i}`).join('\n')],
  ]

  it.each(MALFORMED)('renders %s without throwing', (_name, input) => {
    expect(() => renderMarkdown(input)).not.toThrow()
    expect(typeof renderMarkdown(input)).toBe('string')
  })

  it('never leaves an internal placeholder in the output', () => {
    // Fenced blocks are parked under NUL-delimited markers while the markdown
    // rules run. One left behind would travel into the DOM as an invisible
    // control character inside text the user then copies into a terminal.
    for (const [name, input] of MALFORMED) {
      expect(renderMarkdown(input), name).not.toContain(NUL)
    }
    expect(renderMarkdown('```\na\n```\n\ntext\n\n```\nb\n```')).not.toContain(NUL)
  })

  it('keeps a digit that merely looks like a parked block', () => {
    // The markers are NUL-wrapped precisely so ordinary prose — "Schritt 0 von
    // 3" — cannot be mistaken for a placeholder and replaced by a code block.
    const html = renderMarkdown('```\ncode\n```\n\nSchritt 0 von 3')
    expect(html).toContain('Schritt 0 von 3')
    expect(html).toContain('<pre><code>code')
    expect(html.match(/<pre>/g) ?? []).toHaveLength(1)
  })

  it('applies no markdown inside a fenced block', () => {
    // Code is quoted verbatim or it is worthless — a prompt is full of shell
    // and source, where `*` and `#` are syntax, not emphasis.
    const html = renderMarkdown('```\n# not a heading\n**not bold**\n- not a list\n```')
    expect(html).toContain('# not a heading')
    expect(html).toContain('**not bold**')
    expect(html).not.toContain('<h1>')
    expect(html).not.toContain('<strong>')
    expect(html).not.toContain('<li>')
  })
})

describe('renderInlineMarkdown', () => {
  const parse = (html: string) => {
    const host = document.createElement('div')
    host.innerHTML = html
    return host
  }

  it('renders the subset a changelog entry needs', () => {
    const html = renderInlineMarkdown('**fett**, *kursiv* und `code`')
    const host = parse(html)
    expect(host.querySelector('strong')?.textContent).toBe('fett')
    expect(host.querySelector('em')?.textContent).toBe('kursiv')
    expect(host.querySelector('code')?.textContent).toBe('code')
  })

  it('creates no element outside that subset and NO attribute at all', () => {
    // Dieselbe Zusicherung wie für den Block-Renderer, und aus demselben Grund:
    // ohne Attribute kann kein Handler und kein javascript:-Ziel entstehen.
    const evil = '<img src=x onerror=alert(1)> [x](javascript:alert(1)) <script>alert(1)</script>'
    const host = parse(renderInlineMarkdown(evil))
    const allowed = new Set(['STRONG', 'EM', 'CODE'])
    for (const el of host.querySelectorAll('*')) {
      expect(allowed.has(el.tagName)).toBe(true)
      expect(el.attributes.length).toBe(0)
    }
  })

  it('keeps the payload readable instead of swallowing it', () => {
    // ⚠️ Gegen das DOM prüfen, nicht gegen den String: maskierter, inerter Text
    // enthält legitim `onerror=`.
    const host = parse(renderInlineMarkdown('<script>alert(1)</script>'))
    expect(host.textContent).toContain('alert(1)')
  })

  it('produces no block structure', () => {
    // Der ganze Zweck: ein Punkt in einer Liste darf keine Überschrift und
    // keinen Absatz erzeugen.
    const host = parse(renderInlineMarkdown('# keine Überschrift\n- kein Listenpunkt'))
    expect(host.querySelector('h1, h2, h3, p, ul, li')).toBeNull()
  })

  it('survives empty and undefined input', () => {
    expect(renderInlineMarkdown('')).toBe('')
    expect(renderInlineMarkdown(undefined as unknown as string)).toBe('')
  })
})
