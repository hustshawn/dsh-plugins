/**
 * Root resolution: which directory a preview request resolves against.
 *
 * This is the regression suite for the defect that made the feature unusable
 * whenever `dsh web` was launched from somewhere other than the workspace. The
 * root must come from the SESSION's recorded cwd, and only fall back to the Host
 * process cwd when no session can answer.
 */
import { describe, expect, it, vi } from 'vitest'
import { resolveSessionRoot, type RootSources } from '../src/session-root.ts'

const FALLBACK = '/opt/dsh'
const WORKSPACE = '/root/temp'

/** A live-session store holding the given id/cwd pairs. */
function liveStore(sessions: Record<string, string | undefined>) {
  return {
    get: vi.fn((id: string) =>
      (id in sessions ? { header: { id, cwd: sessions[id] } } : undefined)),
  }
}

/** A persistence service listing the given durable headers. */
function persistence(headers: ReadonlyArray<{ id: string, cwd?: string }>) {
  return { list: vi.fn(async () => headers) }
}

/** Sources with nothing but the fallback. */
function bare(): RootSources {
  return { sessions: undefined, persistence: undefined, fallbackRoot: FALLBACK }
}

describe('a live session', () => {
  it('roots the request at its recorded cwd', async () => {
    // The whole point: the launch directory is irrelevant.
    const sources = { ...bare(), sessions: liveStore({ 's1': WORKSPACE }) }
    await expect(resolveSessionRoot('s1', sources as never)).resolves.toBe(WORKSPACE)
  })

  it('is preferred over the durable header', async () => {
    const sources = {
      ...bare(),
      sessions: liveStore({ 's1': '/live/cwd' }),
      persistence: persistence([{ id: 's1', cwd: '/durable/cwd' }]),
    }
    await expect(resolveSessionRoot('s1', sources as never)).resolves.toBe('/live/cwd')
  })

  it('does not consult persistence when the live header answered', async () => {
    const store = persistence([{ id: 's1', cwd: '/durable/cwd' }])
    const sources = { ...bare(), sessions: liveStore({ 's1': WORKSPACE }), persistence: store }
    await resolveSessionRoot('s1', sources as never)
    expect(store.list).not.toHaveBeenCalled()
  })
})

describe('a cold session', () => {
  it('roots the request at its durable cwd', async () => {
    // Opening an artifact from older history after a restart: the session is on
    // disk but not loaded, so the live store cannot answer.
    const sources = {
      ...bare(),
      sessions: liveStore({}),
      persistence: persistence([{ id: 's1', cwd: WORKSPACE }]),
    }
    await expect(resolveSessionRoot('s1', sources as never)).resolves.toBe(WORKSPACE)
  })

  it('picks the matching session out of many', async () => {
    const sources = {
      ...bare(),
      persistence: persistence([
        { id: 'other', cwd: '/elsewhere' },
        { id: 's1', cwd: WORKSPACE },
        { id: 'later', cwd: '/later' },
      ]),
    }
    await expect(resolveSessionRoot('s1', sources as never)).resolves.toBe(WORKSPACE)
  })

  it('falls back when the id is in neither place', async () => {
    const sources = {
      ...bare(),
      sessions: liveStore({}),
      persistence: persistence([{ id: 'other', cwd: '/elsewhere' }]),
    }
    await expect(resolveSessionRoot('s1', sources as never)).resolves.toBe(FALLBACK)
  })
})

describe('falling back', () => {
  it('uses the fallback when no session id was given', async () => {
    await expect(resolveSessionRoot('', bare())).resolves.toBe(FALLBACK)
  })

  it('does not look anything up without an id', async () => {
    const store = liveStore({ 's1': WORKSPACE })
    await resolveSessionRoot('', { ...bare(), sessions: store } as never)
    expect(store.get).not.toHaveBeenCalled()
  })

  it('uses the fallback when neither service is composed', async () => {
    await expect(resolveSessionRoot('s1', bare())).resolves.toBe(FALLBACK)
  })

  it.each([
    ['undefined', undefined],
    ['empty', ''],
  ])('uses the fallback when the recorded cwd is %s', async (_name, cwd) => {
    // SessionHeader.cwd is optional, so a session may have recorded none.
    const sources = { ...bare(), sessions: liveStore({ 's1': cwd }) }
    await expect(resolveSessionRoot('s1', sources as never)).resolves.toBe(FALLBACK)
  })

  it('tries the durable header when a live session recorded no cwd', async () => {
    const sources = {
      ...bare(),
      sessions: liveStore({ 's1': undefined }),
      persistence: persistence([{ id: 's1', cwd: WORKSPACE }]),
    }
    await expect(resolveSessionRoot('s1', sources as never)).resolves.toBe(WORKSPACE)
  })

  it('falls back rather than failing when the listing throws', async () => {
    // A backend failure must not turn a preview into a 500.
    const sources = {
      ...bare(),
      persistence: { list: vi.fn(async () => { throw new Error('backend down') }) },
    }
    await expect(resolveSessionRoot('s1', sources as never)).resolves.toBe(FALLBACK)
  })
})
