/**
 * Artifact Preview plugin, host half: registers a `/preview` prefix route on
 * the webserver to serve workspace HTML and rendered Markdown files.
 */
import { readFile } from 'node:fs/promises'
import { resolve, normalize, sep, extname, isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

export const name = 'client-ui-artifact-preview'
export const inject = ['webServer']

/** Minimal Markdown → HTML conversion (GitHub-flavored subset). */
function markdownToHtml(md: string): string {
  let html = md
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return `<pre><code class="language-${lang || 'text'}">${escaped}</code></pre>`
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
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" style="max-width:100%">')
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  html = html.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>')
  html = html.replace(/^[\-\*]\s+(.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
  html = html.replace(/^\|(.+)\|$/gm, (_, content) => {
    const cells = content.split('|').map((c: string) => c.trim())
    if (cells.every((c: string) => /^[-:]+$/.test(c))) return ''
    return '<tr>' + cells.map((c: string) => `<td>${c}</td>`).join('') + '</tr>'
  })
  html = html.replace(/(<tr>.*<\/tr>\n?)+/g, '<table>$&</table>')
  html = html.replace(/\n\n+/g, '</p><p>')
  html = html.replace(/([^>])\n([^<])/g, '$1<br>$2')
  html = '<p>' + html + '</p>'
  html = html.replace(/<p>\s*<\/p>/g, '')
  html = html.replace(/<p>\s*(<(?:h[1-6]|pre|ul|table|blockquote|hr)>)/g, '$1')
  html = html.replace(/(<\/(?:h[1-6]|pre|ul|table|blockquote|hr)>)\s*<\/p>/g, '$1')
  return html
}

const GITHUB_CSS = `<style>
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

function renderMarkdown(md: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">${GITHUB_CSS}</head><body>${markdownToHtml(md)}</body></html>`
}

export function apply(ctx: Context): void {
  const workspaceRoot = process.cwd()

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/preview',
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405); res.end(); return
      }
      const rawPath = new URL(req.url ?? '/', 'http://x').pathname
      const requested = decodeURIComponent(rawPath.slice('/preview/'.length))
      if (requested === '') { res.writeHead(400); res.end('missing path'); return }

      // Tools report model-facing paths, which are absolute; a caller may also
      // pass a workspace-relative path. Resolve an absolute request directly so
      // it is not concatenated onto the root, then apply the same containment
      // check to both forms.
      const target = isAbsolute(requested)
        ? resolve(normalize(requested))
        : resolve(normalize(`${workspaceRoot}/${requested}`))
      if (target !== workspaceRoot && !target.startsWith(workspaceRoot + sep)) {
        res.writeHead(403); res.end('traversal denied'); return
      }

      try {
        const content = await readFile(target, 'utf8')
        const ext = extname(target).toLowerCase()
        if (ext === '.md' || ext === '.markdown') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          res.end(renderMarkdown(content))
        } else {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          res.end(content)
        }
      } catch {
        res.writeHead(404); res.end('not found')
      }
    },
  }), 'artifact-preview: /preview route')
}
