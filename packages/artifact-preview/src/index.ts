/**
 * Artifact Preview plugin, host half: serves previewable workspace files on a
 * session-scoped `/preview/<sessionId>/<path>` route so the browser panel can
 * load them in an iframe.
 *
 * Markdown is converted to a styled page; every other extension is served
 * verbatim. Root resolution lives in `./session-root.ts` and path containment in
 * `./preview-path.ts`.
 * @module
 */
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { isMarkdownExtension, renderMarkdownPage } from './markdown.ts'
import { previewRequestFromUrl, resolvePreviewTarget } from './preview-path.ts'
import { resolveSessionRoot, type RootSources } from './session-root.ts'

/** Stable Cordis plugin name. */
export const name = 'artifact-preview'

/**
 * Services this plugin reads.
 *
 * Only `webServer` is required. `sessions` and `sessionPersistence` are resolved
 * per request through `ctx.get`, so a composition without them still serves
 * previews rooted at the Host cwd rather than failing to load.
 */
export const inject = ['webServer']

/** The route path this plugin claims on the webserver. */
export const ROUTE_PATH = '/preview'

/** Response body served instead of a file, by refusal reason. */
const REFUSAL = {
  method: '',
  missingPath: 'missing session id or path',
  denied: 'path outside the session workspace',
  notFound: 'not found',
} as const

/**
 * Build the `/preview` request handler.
 *
 * Exported so the route's behaviour can be exercised directly: the handler owns
 * the whole response, and every branch below is a distinct answer a client can
 * observe.
 * @param sources - Where the per-session root is read from.
 * @returns A handler owning the full response lifecycle of one request.
 */
export function createPreviewHandler(
  sources: RootSources,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    // Named routes own their method handling; anything but a read is refused
    // before a path is resolved.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end(REFUSAL.method)
      return
    }
    const { sessionId, path } = previewRequestFromUrl(req.url)
    const workspaceRoot = await resolveSessionRoot(sessionId, sources)
    const resolved = resolvePreviewTarget(path, workspaceRoot)
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
  const handler = createPreviewHandler({
    // Resolved per request rather than captured: a service can arrive or depart
    // while the route is mounted, and the session's own cwd is the answer in
    // either case.
    get sessions() { return ctx.get('sessions') },
    get persistence() { return ctx.get('sessionPersistence') },
    // Reached only when no session answers, which is why it is the last tier.
    fallbackRoot: process.cwd(),
  })
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PATH, handler }),
    'artifact-preview: /preview route',
  )
}
