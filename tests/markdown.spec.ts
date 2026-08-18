/**
 * Markdown conversion behaviour: what the converter promises to turn into
 * structure, and the documented edges where it deliberately stops.
 */
import { describe, expect, it } from 'vitest'
import { isMarkdownExtension, markdownToHtml, renderMarkdownPage } from '../src/markdown.ts'

describe('markdownToHtml', () => {
  it.each([
    ['# h1', '<h1>h1</h1>'],
    ['## h2', '<h2>h2</h2>'],
    ['### h3', '<h3>h3</h3>'],
    ['#### h4', '<h4>h4</h4>'],
    ['##### h5', '<h5>h5</h5>'],
    ['###### h6', '<h6>h6</h6>'],
  ])('turns %j into a heading', (source, expected) => {
    expect(markdownToHtml(source)).toContain(expected)
  })

  it('does not read a hash without a space as a heading', () => {
    expect(markdownToHtml('#nothash')).not.toContain('<h1>')
  })

  it.each([
    ['**bold**', '<strong>bold</strong>'],
    ['*italic*', '<em>italic</em>'],
    ['***both***', '<strong><em>both</em></strong>'],
    ['~~struck~~', '<del>struck</del>'],
  ])('converts %j inline emphasis', (source, expected) => {
    expect(markdownToHtml(source)).toContain(expected)
  })

  it('links and images each get their own element', () => {
    expect(markdownToHtml('[text](https://example.com)'))
      .toContain('<a href="https://example.com">text</a>')
    expect(markdownToHtml('![alt](pic.png)')).toContain('<img alt="alt" src="pic.png"')
  })

  it('reads an image before a link, since both open with a bracket group', () => {
    const html = markdownToHtml('![alt](pic.png)')
    expect(html).toContain('<img')
    // A link rule winning would leave an anchor and a stray '!'.
    expect(html).not.toContain('<a href="pic.png">')
  })

  it('keeps a fenced block as code and records its language', () => {
    const html = markdownToHtml('```python\nprint(1)\n```')
    expect(html).toContain('<pre><code class="language-python">')
    expect(html).toContain('print(1)')
  })

  it('labels an unlabelled fence as text rather than leaving the class empty', () => {
    expect(markdownToHtml('```\nplain\n```')).toContain('class="language-text"')
  })

  it('escapes markup inside a fence so code cannot become elements', () => {
    const html = markdownToHtml('```\n<script>alert(1)</script>\n```')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('leaves markdown syntax inside a fence uninterpreted', () => {
    const html = markdownToHtml('```\n# not a heading\n**not bold**\n```')
    expect(html).not.toContain('<h1>')
    expect(html).not.toContain('<strong>')
  })

  it.each([
    ['emphasis', '**bold**', '<strong>'],
    ['italic', '*it*', '<em>'],
    ['strikethrough', '~~s~~', '<del>'],
    ['link', '[text](url)', '<a '],
    ['image', '![alt](pic.png)', '<img'],
    ['bullet', '- item', '<li>'],
    ['blockquote', '> quoted', '<blockquote>'],
    ['rule', '---', '<hr>'],
    ['table row', '| a | b |', '<tr>'],
  ])('does not convert %s inside a fence', (_name, source, tag) => {
    // Inline rules match anywhere in the string, so a fence must be lifted out
    // for the whole pass rather than merely converted first.
    expect(markdownToHtml(`\`\`\`\n${source}\n\`\`\``)).not.toContain(tag)
  })

  it('does not turn a checkbox marker inside a fence into a symbol', () => {
    const html = markdownToHtml('```\n[ ] todo\n[x] done\n```')
    expect(html).not.toContain('☐')
    expect(html).not.toContain('☑')
  })

  it('keeps several fences separate and in source order', () => {
    const html = markdownToHtml('```\nfirst\n```\n\nmiddle\n\n```\nsecond\n```')
    expect(html.indexOf('first')).toBeLessThan(html.indexOf('second'))
    expect(html.match(/<pre>/g)).toHaveLength(2)
    expect(html).toContain('middle')
  })

  it('converts markdown outside a fence while protecting the inside', () => {
    const html = markdownToHtml('**real bold**\n\n```\n**fake bold**\n```')
    expect(html).toContain('<strong>real bold</strong>')
    expect(html).toContain('**fake bold**')
  })

  it('leaves no placeholder text in the output', () => {
    const html = markdownToHtml('```\ncode\n```')
    expect(html).not.toContain('dsh-fence')
    expect(html).not.toContain('\u0000')
  })

  it('converts inline code', () => {
    expect(markdownToHtml('use `npm ci` here')).toContain('<code>npm ci</code>')
  })

  it('groups consecutive bullets into one list', () => {
    const html = markdownToHtml('- one\n- two')
    expect(html).toContain('<ul>')
    expect(html.match(/<li>/g)).toHaveLength(2)
  })

  it('accepts both bullet markers', () => {
    expect(markdownToHtml('* star')).toContain('<li>star</li>')
    expect(markdownToHtml('- dash')).toContain('<li>dash</li>')
  })

  it('converts a blockquote', () => {
    expect(markdownToHtml('> quoted')).toContain('<blockquote>quoted</blockquote>')
  })

  it('converts a horizontal rule', () => {
    expect(markdownToHtml('---')).toContain('<hr>')
  })

  it('builds a table and drops its alignment separator', () => {
    const html = markdownToHtml('| a | b |\n| --- | --- |\n| 1 | 2 |')
    expect(html).toContain('<table>')
    expect(html).toContain('<td>a</td>')
    expect(html).toContain('<td>1</td>')
    // The dashes row is layout, not a data row.
    expect(html).not.toContain('<td>---</td>')
  })

  it('renders task-list markers as checkboxes', () => {
    expect(markdownToHtml('- [ ] todo')).toContain('☐')
    expect(markdownToHtml('- [x] done')).toContain('☑')
  })

  it('does not leave an empty paragraph around block elements', () => {
    expect(markdownToHtml('# heading')).not.toContain('<p></p>')
    expect(markdownToHtml('# heading')).not.toMatch(/<p>\s*<h1>/)
  })

  it('returns no content for empty input', () => {
    expect(markdownToHtml('').trim()).toBe('')
  })

  it('passes raw HTML through, because it renders and does not sanitize', () => {
    // Pinning the documented limitation: containment is the iframe sandbox.
    expect(markdownToHtml('<b>raw</b>')).toContain('<b>raw</b>')
  })
})

describe('renderMarkdownPage', () => {
  it('wraps the fragment in a complete document', () => {
    const page = renderMarkdownPage('# hi')
    expect(page.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(page).toContain('<meta charset="UTF-8">')
    expect(page).toContain('</body></html>')
    expect(page).toContain('<h1>hi</h1>')
  })

  it('carries the stylesheet inline, so the iframe needs no extra request', () => {
    const page = renderMarkdownPage('text')
    expect(page).toContain('<style>')
    expect(page).toContain('background: #fff')
  })
})

describe('isMarkdownExtension', () => {
  it.each(['.md', '.markdown'])('treats %s as markdown', (ext) => {
    expect(isMarkdownExtension(ext)).toBe(true)
  })

  it.each(['.html', '.htm', '.txt', '.json', ''])('does not treat %j as markdown', (ext) => {
    expect(isMarkdownExtension(ext)).toBe(false)
  })
})
