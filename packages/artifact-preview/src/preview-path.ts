/**
 * Request-path resolution for the `/preview` route: turning a URL into a file
 * to read, or into the refusal that must be answered instead.
 *
 * Separated from the route handler so the containment rule is testable without
 * an HTTP server. This is the module that decides what is reachable, so its
 * behaviour is a security property, not a convenience.
 * @module
 */

import { isAbsolute, normalize, resolve, sep } from 'node:path'

/** The URL prefix this route owns, including its trailing separator. */
export const PREVIEW_PREFIX = '/preview/'

/** A resolved target file, or the reason the request is refused. */
export type ResolvedRequest =
  | { readonly kind: 'file', readonly target: string }
  | { readonly kind: 'missing-path' }
  | { readonly kind: 'denied' }

/**
 * Resolve a decoded request path against the workspace root.
 *
 * Both path forms are accepted because both occur: a tool reports the
 * model-facing path, which is ABSOLUTE, while a hand-written link is usually
 * workspace-relative. An absolute request is resolved on its own rather than
 * concatenated onto the root — concatenating produced `/root//abs/path`, which
 * resolves outside the tree and answered 404 for every real file.
 *
 * Containment is applied to BOTH forms after resolution, so an absolute path is
 * not a way around the root and neither is `..` in a relative one.
 * @param requested - Decoded path from the URL, without the route prefix.
 * @param workspaceRoot - Absolute directory requests may not escape.
 * @returns The file to read, or the refusal to answer.
 */
export function resolvePreviewTarget(requested: string, workspaceRoot: string): ResolvedRequest {
  if (requested === '') return { kind: 'missing-path' }
  const target = isAbsolute(requested)
    ? resolve(normalize(requested))
    : resolve(normalize(`${workspaceRoot}/${requested}`))
  // The root itself is allowed; anything else must sit beneath it. Comparing
  // with `sep` appended prevents a sibling whose name merely starts with the
  // root's (`/ws-other` against root `/ws`) from passing as contained.
  if (target !== workspaceRoot && !target.startsWith(workspaceRoot + sep)) {
    return { kind: 'denied' }
  }
  return { kind: 'file', target }
}

/**
 * Extract the session id and file path from a request URL.
 *
 * The route is session-scoped — `/preview/<sessionId>/<encoded path>` — because
 * the root a request resolves against is the SESSION's working directory, and
 * one Host serves many sessions. The id therefore has to travel with the
 * request; a Host-wide root cannot answer for all of them.
 *
 * A malformed percent-escape yields no path rather than throwing: the route must
 * answer the request, and an undecodable path names no file.
 * @param url - Raw request URL (`req.url`).
 * @returns The session id and decoded path; either is empty when absent or undecodable.
 */
export function previewRequestFromUrl(url: string | undefined): PreviewRequest {
  const pathname = new URL(url ?? '/', 'http://placeholder.invalid').pathname
  if (!pathname.startsWith(PREVIEW_PREFIX)) return { sessionId: '', path: '' }
  const rest = pathname.slice(PREVIEW_PREFIX.length)
  // The id is one segment and never contains a separator, so the FIRST slash
  // splits it from the path. The path keeps every later slash, which is what
  // makes an absolute path expressible when it is not percent-encoded.
  const boundary = rest.indexOf('/')
  if (boundary === -1) return { sessionId: '', path: '' }
  try {
    return {
      sessionId: decodeURIComponent(rest.slice(0, boundary)),
      path: decodeURIComponent(rest.slice(boundary + 1)),
    }
  } catch {
    // A lone '%' or a bad escape sequence; treat it as naming nothing.
    return { sessionId: '', path: '' }
  }
}

/** The session and file one preview request names. */
export interface PreviewRequest {
  /** Session whose recorded working directory is the root; empty when unparseable. */
  readonly sessionId: string
  /** Decoded file path; empty when absent or undecodable. */
  readonly path: string
}
