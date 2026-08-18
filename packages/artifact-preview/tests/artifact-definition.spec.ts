/**
 * The Conversation Node Definition, driven through a miniature engine that
 * mirrors the real one's contract: `match` sees one event, a matched start opens
 * a Context keyed by `(kind, id)`, and updates fold into the Context with that
 * same id. Unknown ids are dropped, exactly as the engine drops them.
 *
 * This is where the "no button appeared" defect lived, so the suite is written
 * against event payloads in the shape a real session log records.
 */
import { describe, expect, it } from 'vitest'
import { artifactDefinition, ARTIFACT_KIND, type ArtifactState } from '../src/client/artifact-definition.ts'

/** Minimal session event. */
interface Event {
  type: string
  seq: number
  data: Record<string, unknown>
}

let nextSeq = 1

/** A `tool/call` event for a write of `path`. */
function writeCall(path: string, id = 'call-1', over: Record<string, unknown> = {}): Event {
  return {
    type: 'tool/call',
    seq: nextSeq++,
    data: {
      turn: 1,
      step: 2,
      callId: id,
      name: 'write',
      arguments: JSON.stringify({ file_path: path, content: 'x' }),
      ...over,
    },
  }
}

/** The paired `tool/result` for `id`. */
function toolResult(id = 'call-1', isError = false): Event {
  return {
    type: 'tool/result',
    seq: nextSeq++,
    data: {
      turn: 1,
      step: 2,
      message: {
        source: { kind: 'tool', callId: id },
        content: [{ type: 'text', content: 'done', isError }],
      },
    },
  }
}

/**
 * Replay events through the Definition the way the engine does.
 * @param events - Events in ascending log order.
 * @returns The published view Nodes, in Context creation order.
 */
function replay(events: readonly Event[]) {
  const contexts = new Map<string, {
    key: string
    id: string
    start?: { event: Event, location: { kind: string } }
    matches: Array<{ event: Event, location: { kind: string } }>
    state: ArtifactState | undefined
  }>()
  for (const event of events) {
    const match = artifactDefinition.match(event as never)
    if (match === null) continue
    if (match.role === 'start') {
      // At most one start per (kind, id).
      if (contexts.has(match.id)) continue
      const located = { event, location: { kind: 'step' } }
      const context = { key: `${ARTIFACT_KIND}:${match.id}`, id: match.id, start: located, matches: [located], state: undefined as ArtifactState | undefined }
      context.state = artifactDefinition.start(context as never, { event } as never)
      contexts.set(match.id, context)
      continue
    }
    const context = contexts.get(match.id)
    // The engine performs a keyed lookup and drops an update with no Context.
    if (context === undefined) continue
    context.matches.push({ event, location: { kind: 'step' } })
    context.state = artifactDefinition.update(context as never, { event } as never)
  }
  return [...contexts.values()].map(context => ({
    context,
    node: artifactDefinition.buildViewNode!(context as never),
  }))
}

describe('definition shape', () => {
  it('declares the kind and target the registrations use', () => {
    expect(artifactDefinition.kind).toBe(ARTIFACT_KIND)
    expect(artifactDefinition.target).toBe('chat')
  })
})

describe('matching', () => {
  it('opens a Context on a previewable write, keyed by callId', () => {
    const match = artifactDefinition.match(writeCall('/ws/a.html', 'c9') as never)
    expect(match).toEqual({ id: 'c9', role: 'start' })
  })

  it('updates on a result, keyed by the same callId', () => {
    const match = artifactDefinition.match(toolResult('c9') as never)
    expect(match).toEqual({ id: 'c9', role: 'update' })
  })

  it('ignores a write of a non-previewable file', () => {
    expect(artifactDefinition.match(writeCall('/ws/a.ts') as never)).toBeNull()
  })

  it('ignores a call whose tool writes nothing', () => {
    const call = writeCall('/ws/a.md', 'c1', {
      name: 'bash',
      arguments: JSON.stringify({ command: 'ls' }),
    })
    expect(artifactDefinition.match(call as never)).toBeNull()
  })

  it.each(['turn/start', 'assistant/chunk', 'user/message', 'tool-call-chunks'])(
    'ignores a %s event', (type) => {
      expect(artifactDefinition.match({ type, seq: 1, data: {} } as never)).toBeNull()
    },
  )

  it('ignores a previewable write whose call carries no id', () => {
    // With no id there is nothing to correlate the later result against.
    const call = writeCall('/ws/a.md', 'c1', { callId: undefined })
    expect(artifactDefinition.match(call as never)).toBeNull()
  })

  it('ignores a result whose message names no call', () => {
    const orphan = { type: 'tool/result', seq: 1, data: { turn: 1, step: 2, message: { content: [] } } }
    expect(artifactDefinition.match(orphan as never)).toBeNull()
  })

  it('does not depend on callView, which the session log never carries', () => {
    // The original defect: reading `callView` off tool/result matched nothing.
    const bare = artifactDefinition.match(toolResult('c1') as never)
    expect(bare).not.toBeNull()
  })
})

describe('lifecycle', () => {
  it('publishes a visible Node once a write settles successfully', () => {
    const [entry] = replay([writeCall('/ws/page.html', 'c1'), toolResult('c1')])
    expect(entry!.node).toMatchObject({
      kind: ARTIFACT_KIND,
      target: 'chat',
      visibility: 'visible',
      data: { path: '/ws/page.html', fileName: 'page.html', ext: 'HTML' },
    })
  })

  it('keeps the Node hidden while the write is still running', () => {
    // The button offers to OPEN a file, so it must not appear before there is one.
    const [entry] = replay([writeCall('/ws/page.html', 'c1')])
    expect(entry!.node?.visibility).toBe('hidden')
    expect(entry!.context.state?.settled).toBe(false)
  })

  it('keeps the Node hidden when the write failed', () => {
    const [entry] = replay([writeCall('/ws/page.html', 'c1'), toolResult('c1', true)])
    expect(entry!.context.state).toMatchObject({ settled: true, failed: true })
    expect(entry!.node?.visibility).toBe('hidden')
  })

  it('anchors the Node at the call seq, not the result seq', () => {
    nextSeq = 100
    const call = writeCall('/ws/a.md', 'c1')
    const [entry] = replay([call, toolResult('c1')])
    expect(entry!.node?.anchorSeq).toBe(call.seq)
  })

  it('pairs each write with its own result across interleaved calls', () => {
    const nodes = replay([
      writeCall('/ws/first.html', 'c1'),
      writeCall('/ws/second.md', 'c2'),
      toolResult('c2'),
      toolResult('c1'),
    ])
    expect(nodes).toHaveLength(2)
    const byName = new Map(nodes.map(n => [n.node?.data.fileName, n.node]))
    expect(byName.get('first.html')?.visibility).toBe('visible')
    expect(byName.get('second.md')?.visibility).toBe('visible')
  })

  it('does not let one result settle a different call', () => {
    const nodes = replay([
      writeCall('/ws/a.html', 'c1'),
      writeCall('/ws/b.html', 'c2'),
      toolResult('c1'),
    ])
    const byId = new Map(nodes.map(n => [n.context.id, n]))
    expect(byId.get('c1')!.node?.visibility).toBe('visible')
    expect(byId.get('c2')!.node?.visibility).toBe('hidden')
  })

  it('ignores a result for a call it never opened', () => {
    expect(replay([toolResult('unknown')])).toHaveLength(0)
  })

  it('keeps one Context when a call repeats', () => {
    const nodes = replay([writeCall('/ws/a.md', 'c1'), writeCall('/ws/a.md', 'c1')])
    expect(nodes).toHaveLength(1)
  })

  it('opens separate Contexts for the same file written twice', () => {
    // Two writes are two events worth previewing, even at one path.
    const nodes = replay([
      writeCall('/ws/a.md', 'c1'), toolResult('c1'),
      writeCall('/ws/a.md', 'c2'), toolResult('c2'),
    ])
    expect(nodes).toHaveLength(2)
    expect(nodes.every(n => n.node?.visibility === 'visible')).toBe(true)
  })

  it('rejects a start that is not a tool/call', () => {
    const context = { key: 'k', id: 'c1', matches: [], state: undefined }
    expect(() => artifactDefinition.start(context as never, { event: toolResult('c1') } as never))
      .toThrow(/requires tool\/call/)
  })

  it('leaves state untouched by an unrelated update event', () => {
    const [entry] = replay([writeCall('/ws/a.md', 'c1')])
    const before = entry!.context.state
    const after = artifactDefinition.update(
      entry!.context as never,
      { event: { type: 'turn/end', seq: 99, data: {} } } as never,
    )
    expect(after).toBe(before)
  })
})

describe('published data', () => {
  it('publishes Step data for the sharing lane', () => {
    const [entry] = replay([writeCall('/ws/dir/page.html', 'c1'), toolResult('c1')])
    const published = artifactDefinition.buildLocationData!(entry!.context as never, 'step')
    expect(published).toMatchObject({
      kind: 'step',
      turn: 1,
      step: 2,
      key: ARTIFACT_KIND,
      value: { fileName: 'page.html', ext: 'HTML' },
    })
  })

  it('publishes nothing for the turn scope, which it does not own', () => {
    const [entry] = replay([writeCall('/ws/a.md', 'c1'), toolResult('c1')])
    expect(artifactDefinition.buildLocationData!(entry!.context as never, 'turn')).toBeNull()
  })

  it('publishes nothing before state exists', () => {
    const pending = { key: 'k', id: 'c1', matches: [], state: undefined }
    expect(artifactDefinition.buildLocationData!(pending as never, 'step')).toBeNull()
    expect(artifactDefinition.buildViewNode!(pending as never)).toBeNull()
  })

  it('reports an unresolved location when no match carries one', () => {
    const context = { key: 'k', id: 'c1', matches: [], state: { turn: 1, step: 2, path: '/ws/a.md', seq: 1, settled: true, failed: false } }
    expect(artifactDefinition.buildViewNode!(context as never)?.location).toEqual({ kind: 'unresolved' })
  })
})
