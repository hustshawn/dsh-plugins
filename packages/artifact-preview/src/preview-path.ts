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
 * Extract the decoded file path from a request URL.
 *
 * A malformed percent-escape is reported as no path rather than throwing: the
 * route must answer the request, and an undecodable path names no file.
 * @param url - Raw request URL (`req.url`).
 * @returns The decoded path after the route prefix; empty when absent or undecodable.
 */
export function previewPathFromUrl(url: string | undefined): string {
  const pathname = new URL(url ?? '/', 'http://placeholder.invalid').pathname
  if (!pathname.startsWith(PREVIEW_PREFIX)) return ''
  const raw = pathname.slice(PREVIEW_PREFIX.length)
  try {
    return decodeURIComponent(raw)
  } catch {
    // A lone '%' or a bad escape sequence; treat it as naming nothing.
    return ''
  }
}
