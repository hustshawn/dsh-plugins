/**
 * Resolving the directory a preview request is rooted at.
 *
 * The root is the SESSION's own working directory, not the Host process cwd.
 * Those are independent values: `dsh web` is often launched from an install or
 * service directory while the agent works elsewhere, and a Host serves several
 * sessions with different workspaces. Rooting previews at `process.cwd()` made
 * every artifact unreachable whenever the launch directory was not an ancestor
 * of the workspace.
 *
 * Three tiers, narrowest first:
 *
 * 1. A **live** session's header, read synchronously from the session store.
 * 2. A **cold** session's durable header, from the optional persistence
 *    service — this is what makes an artifact in older history still open after
 *    a restart, when the session is on disk but not loaded.
 * 3. The Host process cwd, when neither can answer.
 * @module
 */
import type { SessionHeader, SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'

/** The reads this resolver needs, as the services expose them. */
export interface RootSources {
  /** Live-session lookup; synchronous, and undefined for a session not loaded. */
  readonly sessions: Pick<SessionStore, 'get'> | undefined
  /** Durable headers for cold sessions; absent when no persistence is composed. */
  readonly persistence: Pick<SessionPersistence, 'list'> | undefined
  /** Last-resort root when no session answers. */
  readonly fallbackRoot: string
}

/**
 * Resolve the root for one session id.
 *
 * `SessionHeader.cwd` is optional, so a session that recorded none falls through
 * to the next tier rather than being treated as rooted at the empty string.
 * @param sessionId - Session the request named.
 * @param sources - Live store, durable persistence, and the fallback root.
 * @returns The absolute directory this request resolves against.
 */
export async function resolveSessionRoot(
  sessionId: string,
  sources: RootSources,
): Promise<string> {
  if (sessionId === '') return sources.fallbackRoot
  const id = sessionId as SessionId

  const live = sources.sessions?.get(id)?.header.cwd
  if (live !== undefined && live !== '') return live

  const durable = await durableCwd(id, sources.persistence)
  if (durable !== undefined && durable !== '') return durable

  return sources.fallbackRoot
}

/**
 * Recorded cwd of a session that is on disk but not loaded.
 *
 * `list()` is the lightweight metadata read — it parses headers without the
 * event log, which is all a cwd needs. A backend failure yields undefined so the
 * caller falls back rather than turning a cold-history preview into an error.
 * @param id - Session to look up.
 * @param persistence - Persistence service, when one is composed.
 * @returns The recorded cwd, or undefined when unavailable.
 */
async function durableCwd(
  id: SessionId,
  persistence: Pick<SessionPersistence, 'list'> | undefined,
): Promise<string | undefined> {
  if (persistence === undefined) return undefined
  let headers: readonly SessionHeader[]
  try {
    headers = await persistence.list()
  } catch {
    // A listing failure is not this request's problem to report: the fallback
    // root still yields an answer, and the alternative is a 500 for a preview.
    return undefined
  }
  return headers.find(header => header.id === id)?.cwd
}
