/**
 * Markdown to HTML conversion for previewed `.md` files, plus the page shell
 * that carries the GitHub-like stylesheet.
 *
 * Deliberately dependency-free and deliberately a SUBSET: headings, emphasis,
 * strikethrough, links, images, blockquotes, fenced and inline code, flat
 * lists, simple tables, task-list markers and rules. Nested lists, footnotes,
 * and reference links are out of scope. Fenced code is escaped but not
 * highlighted.
 *
 * This is a renderer, NOT a sanitizer: raw HTML in the source passes through as
 * written. Containment is the iframe's opaque-origin sandbox, not this module.
 * @module
 */

/** Escape the characters that would otherwise close or open a tag inside a code block. */
function escapeCode(code: string): string {
  return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Marker standing in for a fenced block while the other rules run.
 *
 * Built from a control character, which cannot occur in a text document: a
 * printable marker could be typed by an author and would then be replaced with
 * unrelated code on the way out.
 */
const FENCE_PLACEHOLDER = '\u0000dsh-fence:'

/**
 * Convert Markdown source to an HTML fragment.
 * @param md - Markdown source text.
 * @returns The HTML fragment (no `<html>`/`<body>` wrapper).
 */
export function markdownToHtml(md: string): string {
  let html = md
  // Fenced code is lifted out before any other rule runs and reinserted at the
  // very end. Converting it in place is not enough: the inline rules below match
  // anywhere in the string, so `**x**` or `[a](b)` inside a block would still be
  // turned into elements after the block had been emitted.
  const fences: string[] = []
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang: string, code: string) => {
    fences.push(`<pre><code class="language-${lang || 'text'}">${escapeCode(code)}</code></pre>`)
    return `${FENCE_PLACEHOLDER}${String(fences.length - 1)}\u0000`
  })
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>')
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>')
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')
  html = html.replace(/^---+$/gm, '<hr>')
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>')
  // Images before links: both start with a bracket group, and the image rule is
  // the more specific one.
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" style="max-width:100%">')
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  html = html.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>')
  html = html.replace(/^[\-*]\s+(.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
  html = html.replace(/^\|(.+)\|$/gm, (_, content: string) => {
    const cells = content.split('|').map(c => c.trim())
    // A row of only dashes and colons is the alignment separator, not content.
    if (cells.every(c => /^[-:]+$/.test(c))) return ''
    return `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`
  })
  html = html.replace(/(<tr>.*<\/tr>\n?)+/g, '<table>$&</table>')
  html = html.replace(/\[ \]/g, '☐')
  html = html.replace(/\[x\]/gi, '☑')
  html = html.replace(/\n\n+/g, '</p><p>')
  html = html.replace(/([^>])\n([^<])/g, '$1<br>$2')
  html = `<p>${html}</p>`
  // Restore the code blocks before the paragraph cleanup, so a restored <pre>
  // gets unwrapped from its paragraph like every other block element.
  html = html.replace(
    new RegExp(`${FENCE_PLACEHOLDER}(\\d+)\u0000`, 'g'),
    /* v8 ignore next -- every placeholder was written from this same array in
    this same call, so the index always resolves. */
    (_, index: string) => fences[Number(index)] ?? '',
  )
  // Unwrap the paragraph the blanket wrap put around block-level elements.
  html = html.replace(/<p>\s*<\/p>/g, '')
  html = html.replace(/<p>\s*(<(?:h[1-6]|pre|ul|table|blockquote|hr)>)/g, '$1')
  html = html.replace(/(<\/(?:h[1-6]|pre|ul|table|blockquote|hr)>)\s*<\/p>/g, '$1')
  return html
}

/** The GitHub-like stylesheet the rendered page carries inline. */
export const GITHUB_CSS = `<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #1f2328; background: #fff; max-width: 880px; margin: 0 auto; padding: 2rem 3rem; }
h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; margin-bottom: 0.5em; font-weight: 600; line-height: 1.25; }
h1 { font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid #d1d9e0; }
h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid #d1d9e0; }
h3 { font-size: 1.25em; }
p { margin: 0 0 1em; }
a { color: #0969da; text-decoration: none; }
a:hover { text-decoration: underline; }
code { background: rgba(175,184,193,0.2); padding: 0.2em 0.4em; border-radius: 6px; font-size: 85%; font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; }
pre { background: #f6f8fa; border: 1px solid #d1d9e0; border-radius: 6px; padding: 1em; overflow-x: auto; margin: 1em 0; }
pre code { background: none; padding: 0; font-size: 85%; line-height: 1.45; }
blockquote { border-left: 4px solid #d1d9e0; padding: 0.5em 1em; margin: 1em 0; color: #656d76; }
ul, ol { padding-left: 2em; margin: 1em 0; }
li { margin: 0.25em 0; }
hr { border: none; border-top: 1px solid #d1d9e0; margin: 1.5em 0; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
td, th { border: 1px solid #d1d9e0; padding: 6px 13px; }
tr:nth-child(even) { background: #f6f8fa; }
img { max-width: 100%; border-radius: 6px; }
strong { font-weight: 600; }
</style>`

/**
 * Wrap converted Markdown in a complete styled page.
 * @param md - Markdown source text.
 * @returns A full HTML document ready to serve into the preview iframe.
 */
export function renderMarkdownPage(md: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">${GITHUB_CSS}</head><body>${markdownToHtml(md)}</body></html>`
}

/** Extensions served as rendered Markdown rather than verbatim. */
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])

/**
 * Whether a file extension is served as rendered Markdown.
 * @param ext - Lowercase extension including the leading dot.
 * @returns True when the file should be converted rather than passed through.
 */
export function isMarkdownExtension(ext: string): boolean {
  return MARKDOWN_EXTENSIONS.has(ext)
}
