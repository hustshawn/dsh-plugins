/**
 * Reading artifact writes out of session events, and the correlation that turns
 * a call/result pair into one Node.
 *
 * The event payloads here are the shapes observed in a real session log, which
 * is the point: an earlier version read `callView` off `tool/result` and matched
 * nothing, because that field is Host-computed per frame and never logged.
 */
import { describe, expect, it } from 'vitest'
import {
  callId, callPreviewPath, coordinate, fileBasename, fileExt,
  isPreviewable, resultCallId, resultIsError,
} from '../src/client/artifact-events.ts'

/** A `tool/call` payload as the session log records it. */
function callData(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    turn: 3,
    step: 5,
    callId: 'tooluse_abc',
    name: 'write',
    arguments: JSON.stringify({ file_path: '/ws/page.html', content: '<p>x</p>' }),
    ...over,
  }
}

/** A `tool/result` payload as the session log records it. */
function resultData(over: {
  callId?: string
  isError?: boolean
  message?: unknown
} = {}): Record<string, unknown> {
  if ('message' in over) return { turn: 3, step: 5, message: over.message }
  return {
    turn: 3,
    step: 5,
    message: {
      source: { kind: 'tool', callId: over.callId ?? 'tooluse_abc' },
      content: [{ type: 'text', toolCallId: over.callId ?? 'tooluse_abc', content: 'ok', isError: over.isError ?? false }],
      role: 'tool',
      id: 'msg_1',
    },
  }
}

describe('isPreviewable', () => {
  it.each(['a.html', 'a.htm', 'a.md', 'a.markdown', 'A.HTML', 'deep/dir/a.MD'])(
    'accepts %s', (path) => { expect(isPreviewable(path)).toBe(true) },
  )

  it.each(['a.txt', 'a.json', 'a.ts', 'a.html.bak', 'noext', 'a.mdx'])(
    'rejects %s', (path) => { expect(isPreviewable(path)).toBe(false) },
  )
})

describe('fileBasename', () => {
  it.each([
    ['/abs/dir/a.md', 'a.md'],
    ['rel/dir/a.md', 'a.md'],
    ['a.md', 'a.md'],
    ['C:\\win\\dir\\a.md', 'a.md'],
  ])('reduces %j to %j', (path, expected) => {
    expect(fileBasename(path)).toBe(expected)
  })
})

describe('fileExt', () => {
  it.each([
    ['a.md', 'MD'],
    ['a.html', 'HTML'],
    ['a.markdown', 'MARKDOWN'],
    ['noext', ''],
    ['dir.with.dots/a.md', 'MD'],
  ])('reads %j as %j', (path, expected) => {
    expect(fileExt(path)).toBe(expected)
  })
})

describe('callPreviewPath', () => {
  it('reads file_path out of a write call', () => {
    expect(callPreviewPath(callData())).toBe('/ws/page.html')
  })

  it('reads file_path out of an edit call', () => {
    const data = callData({
      name: 'edit',
      arguments: JSON.stringify({ file_path: '/ws/a.md', old_string: 'x', new_string: 'y' }),
    })
    expect(callPreviewPath(data)).toBe('/ws/a.md')
  })

  it.each(['bash', 'read', 'glob', 'grep', 'todo_write'])(
    'ignores a %s call, which writes no artifact', (name) => {
      expect(callPreviewPath(callData({ name }))).toBeUndefined()
    },
  )

  it('ignores a write whose target is not previewable', () => {
    const data = callData({ arguments: JSON.stringify({ file_path: '/ws/a.ts', content: '' }) })
    expect(callPreviewPath(data)).toBeUndefined()
  })

  it('ignores partial arguments rather than throwing', () => {
    // Arguments stream in, so an unparseable prefix is expected mid-turn.
    const data = callData({ arguments: '{"file_path":"/ws/a.m' })
    expect(() => callPreviewPath(data)).not.toThrow()
    expect(callPreviewPath(data)).toBeUndefined()
  })

  it.each([
    ['absent arguments', { arguments: undefined }],
    ['non-string arguments', { arguments: { file_path: '/ws/a.md' } }],
    ['absent name', { name: undefined }],
    ['arguments that parse to a non-object', { arguments: '"just a string"' }],
    ['arguments that parse to null', { arguments: 'null' }],
    ['missing file_path', { arguments: JSON.stringify({ content: 'x' }) }],
    ['non-string file_path', { arguments: JSON.stringify({ file_path: 42 }) }],
    ['empty file_path', { arguments: JSON.stringify({ file_path: '' }) }],
  ])('returns undefined for %s', (_name, over) => {
    expect(callPreviewPath(callData(over))).toBeUndefined()
  })
})

describe('callId', () => {
  it('reads the id a call announces', () => {
    expect(callId(callData())).toBe('tooluse_abc')
  })

  it.each([
    ['absent', undefined],
    ['non-string', 42],
  ])('returns undefined when the id is %s', (_name, value) => {
    expect(callId(callData({ callId: value }))).toBeUndefined()
  })
})

describe('resultCallId', () => {
  it('reads the id from message.source', () => {
    expect(resultCallId(resultData())).toBe('tooluse_abc')
  })

  it.each([
    ['no message', { message: undefined }],
    ['no source', { message: { content: [] } }],
    ['no callId on source', { message: { source: {} } }],
    ['non-string callId', { message: { source: { callId: 7 } } }],
  ])('returns undefined with %s', (_name, over) => {
    expect(resultCallId(resultData(over))).toBeUndefined()
  })
})

describe('resultIsError', () => {
  it('reports an explicit failure', () => {
    expect(resultIsError(resultData({ isError: true }))).toBe(true)
  })

  it('reports success when the flag is false', () => {
    expect(resultIsError(resultData({ isError: false }))).toBe(false)
  })

  it.each([
    ['the flag is absent', { message: { source: { callId: 'x' }, content: [{ type: 'text' }] } }],
    ['content is empty', { message: { source: { callId: 'x' }, content: [] } }],
    ['there is no content', { message: { source: { callId: 'x' } } }],
    ['there is no message', { message: undefined }],
  ])('treats it as success when %s', (_name, over) => {
    // Only an explicit true counts: a missing field must not hide a real artifact.
    expect(resultIsError(resultData(over))).toBe(false)
  })

  it('does not read a truthy non-boolean as failure', () => {
    const over = { message: { source: { callId: 'x' }, content: [{ isError: 'yes' }] } }
    expect(resultIsError(resultData(over))).toBe(false)
  })
})

describe('coordinate', () => {
  it('reads a numeric field', () => {
    expect(coordinate(callData(), 'turn')).toBe(3)
    expect(coordinate(callData(), 'step')).toBe(5)
  })

  it.each([
    ['absent', {}, 'turn'],
    ['non-numeric', { turn: '3' }, 'turn'],
  ])('falls back to 0 when the field is %s', (_name, data, key) => {
    expect(coordinate(data, key)).toBe(0)
  })
})
