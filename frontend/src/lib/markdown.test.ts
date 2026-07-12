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
})
