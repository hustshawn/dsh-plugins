/**
 * Reading previewable artifact writes out of the durable session event stream.
 *
 * The path is taken from a `tool/call`'s own arguments, correlated to its
 * `tool/result` by `callId`. A call's render intent (`callView`, with its
 * `diffs`/`locations`) is Host-computed per frame and is NOT part of the session
 * log, so a reader built on it matches nothing — on replay or live.
 *
 * The durable facts are:
 *
 * ```
 * tool/call.data   = { turn, step, callId, name, arguments }
 * tool/result.data = { turn, step, message }
 * ```
 *
 * where `arguments` is a JSON string carrying `file_path`, and `message` carries
 * `source.callId` plus `content[0].isError`.
 * @module
 */

/** Extensions the preview panel can display. */
const PREVIEWABLE = /\.(html?|md|markdown)$/i

/** Tools whose `file_path` argument names a file they create or change. */
const MUTATION_TOOLS = new Set(['write', 'edit'])

/**
 * Whether a path names a file the panel can preview.
 * @param path - File path to test.
 * @returns True for `.html`, `.htm`, `.md`, and `.markdown`.
 */
export function isPreviewable(path: string): boolean {
  return PREVIEWABLE.test(path)
}

/**
 * Trailing path segment, the part that identifies the file at a glance.
 * @param path - Slash- or backslash-separated path.
 * @returns The final segment, or the whole string when separator-free.
 */
export function fileBasename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/**
 * Uppercase extension for the button and panel badge.
 * @param path - File path to read the extension from.
 * @returns The extension without its dot, uppercased; empty when there is none.
 */
export function fileExt(path: string): string {
  const m = path.match(/\.(\w+)$/)
  return m !== null ? m[1]!.toUpperCase() : ''
}

/**
 * Previewable `file_path` from a `tool/call` payload.
 * @param data - The event's `data` payload.
 * @returns The path, or undefined when this call writes nothing previewable.
 */
export function callPreviewPath(data: Record<string, unknown>): string | undefined {
  const name = data['name']
  if (typeof name !== 'string' || !MUTATION_TOOLS.has(name)) return undefined
  const raw = data['arguments']
  if (typeof raw !== 'string') return undefined
  let args: unknown
  try {
    args = JSON.parse(raw)
  } catch {
    // Arguments stream in, so a partial call is expected rather than malformed;
    // the settled event carries the complete value.
    return undefined
  }
  if (typeof args !== 'object' || args === null) return undefined
  const filePath = (args as Record<string, unknown>)['file_path']
  if (typeof filePath !== 'string' || filePath === '') return undefined
  return isPreviewable(filePath) ? filePath : undefined
}

/**
 * The `callId` a `tool/call` payload announces.
 * @param data - The event's `data` payload.
 * @returns The id, or undefined when absent or not a string.
 */
export function callId(data: Record<string, unknown>): string | undefined {
  const value = data['callId']
  return typeof value === 'string' ? value : undefined
}

/**
 * The `callId` a `tool/result` payload settles.
 * @param data - The event's `data` payload.
 * @returns The id from `message.source`, or undefined when absent.
 */
export function resultCallId(data: Record<string, unknown>): string | undefined {
  const message = data['message'] as { source?: { callId?: unknown } } | undefined
  const id = message?.source?.callId
  return typeof id === 'string' ? id : undefined
}

/**
 * Whether a settled `tool/result` reports failure.
 *
 * Only an explicit `true` counts: an absent flag is the success case, so a
 * missing field must not read as failure and hide a real artifact.
 * @param data - The event's `data` payload.
 * @returns True when the first content block is flagged as an error.
 */
export function resultIsError(data: Record<string, unknown>): boolean {
  const message = data['message'] as { content?: Array<{ isError?: unknown }> } | undefined
  return message?.content?.[0]?.isError === true
}

/**
 * Positive integer field from an event payload, defaulting to 0.
 * @param data - The event's `data` payload.
 * @param key - Field name to read.
 * @returns The number when present, else 0.
 */
export function coordinate(data: Record<string, unknown>, key: string): number {
  const value = data[key]
  return typeof value === 'number' ? value : 0
}
