/**
 * Artifact Preview plugin, host half: serves previewable workspace files on a
 * `/preview` route so the browser panel can load them in an iframe.
 *
 * Markdown is converted to a styled page; every other extension is served
 * verbatim. Path resolution and containment live in `./preview-path.ts`.
 * @module
 */
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { isMarkdownExtension, renderMarkdownPage } from './markdown.ts'
import { previewPathFromUrl, resolvePreviewTarget } from './preview-path.ts'

/** Stable Cordis plugin name. */
export const name = 'artifact-preview'

/** Service required before the route can be registered. */
export const inject = ['webServer']

/** The route path this plugin claims on the webserver. */
export const ROUTE_PATH = '/preview'

/** Response body served instead of a file, by refusal reason. */
const REFUSAL = {
  method: '',
  missingPath: 'missing path',
  denied: 'path outside the workspace root',
  notFound: 'not found',
} as const

/**
 * Build the `/preview` request handler for one workspace root.
 *
 * Exported so the route's behaviour can be exercised directly: the handler owns
 * the whole response, and every branch below is a distinct answer a client can
 * observe.
 * @param workspaceRoot - Absolute directory requests may not escape.
 * @returns A handler owning the full response lifecycle of one request.
 */
export function createPreviewHandler(
  workspaceRoot: string,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    // Named routes own their method handling; anything but a read is refused
    // before a path is even resolved.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end(REFUSAL.method)
      return
    }
    const requested = previewPathFromUrl(req.url)
    const resolved = resolvePreviewTarget(requested, workspaceRoot)
    if (resolved.kind === 'missing-path') {
      res.writeHead(400)
      res.end(REFUSAL.missingPath)
      return
    }
    if (resolved.kind === 'denied') {
      res.writeHead(403)
      res.end(REFUSAL.denied)
      return
    }
    let content: string
    try {
      content = await readFile(resolved.target, 'utf8')
    } catch {
      // Absent, unreadable, or a directory: all of them name no previewable
      // file, and distinguishing them would only describe the tree to a caller.
      res.writeHead(404)
      res.end(REFUSAL.notFound)
      return
    }
    const body = isMarkdownExtension(extname(resolved.target).toLowerCase())
      ? renderMarkdownPage(content)
      : content
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(body)
  }
}

/**
 * Register the preview route; disposing the plugin fiber removes it.
 * @param ctx - Plugin context carrying the `webServer` service.
 */
export function apply(ctx: Context): void {
  // The Host process cwd is the workspace root for a single-workspace `dsh web`.
  const workspaceRoot = process.cwd()
  const handler = createPreviewHandler(workspaceRoot)
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PATH, handler }),
    'artifact-preview: /preview route',
  )
}
