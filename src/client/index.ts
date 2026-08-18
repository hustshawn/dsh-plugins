/**
 * Artifact Preview plugin, browser half.
 *
 * 1. Registers a ConversationNodeDefinition that detects tool/result events
 *    writing .html or .md files, renders an "Open Preview" button as a Chat Node.
 * 2. Registers a shell.overlay component for the right-side artifact panel.
 */
import { createElement, useState, useCallback, useEffect, useRef } from 'react'
import type { ClientContext, ConversationNodeDefinition, ConversationLocation, ConversationNodeContext } from '@deepseek-ai/dsh-client-runtime/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

/**
 * `shell.overlay` is declared by `@deepseek-ai/dsh-client-ui-layout`, which
 * ships no npm package, so its SlotMap entry is restated here rather than
 * imported. Declaration merging makes this additive: when the layout package is
 * present (a source checkout) both declarations describe the same slot, and the
 * runtime spec always comes from the declaring plugin, never from this line.
 *
 * The slot is a frame-wide floating layer above every column: `kind: 'list'`
 * (so a registration MUST carry an `id`) at `scope: 'root'`.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'shell.overlay': { kind: 'list', scope: 'root' }
  }
}

// ── Types ───────────────────────────────────────────────────────────────────

interface ArtifactState {
  readonly turn: number
  readonly step: number
  readonly path: string
  readonly seq: number
  /** The paired `tool/result` arrived. */
  readonly settled: boolean
  /** The settled result reported failure, so there is no file to preview. */
  readonly failed: boolean
}

interface ArtifactChatData {
  readonly path: string
  readonly fileName: string
  readonly ext: string
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    'artifact-preview': ArtifactChatData
  }
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationStepDataMap {
    'artifact-preview': ArtifactChatData
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function fileBasename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

const PREVIEWABLE = /\.(html?|md|markdown)$/i

function isPreviewable(path: string): boolean {
  return PREVIEWABLE.test(path)
}

function fileExt(path: string): string {
  const m = path.match(/\.(\w+)$/)
  return m !== null ? m[1]!.toUpperCase() : ''
}

/** Mutation tools whose `file_path` argument names a file they create or change. */
const MUTATION_TOOLS = new Set(['write', 'edit'])

/**
 * Previewable `file_path` from a `tool/call` event, or undefined.
 *
 * The path comes from the CALL's own arguments, not from a render intent:
 * `tool/result.data` carries only `turn`/`step`/`message`, and `callView` is
 * Host-computed per frame rather than logged, so a Definition reading it never
 * matches on replay.
 */
function callPreviewPath(data: Record<string, unknown>): string | undefined {
  const name = data['name']
  if (typeof name !== 'string' || !MUTATION_TOOLS.has(name)) return undefined
  const raw = data['arguments']
  if (typeof raw !== 'string') return undefined
  let args: unknown
  try {
    args = JSON.parse(raw)
  } catch {
    // Mid-stream truncation leaves argsRaw unparseable; the settled call re-matches.
    return undefined
  }
  if (typeof args !== 'object' || args === null) return undefined
  const filePath = (args as Record<string, unknown>)['file_path']
  if (typeof filePath !== 'string' || filePath === '') return undefined
  return isPreviewable(filePath) ? filePath : undefined
}

/** `callId` a `tool/result` settles, from its message source. */
function resultCallId(data: Record<string, unknown>): string | undefined {
  const message = data['message'] as { source?: { callId?: unknown } } | undefined
  const callId = message?.source?.callId
  return typeof callId === 'string' ? callId : undefined
}

/** True when a settled `tool/result` reports failure. */
function resultIsError(data: Record<string, unknown>): boolean {
  const message = data['message'] as { content?: Array<{ isError?: unknown }> } | undefined
  return message?.content?.[0]?.isError === true
}

function locationOf(context: ConversationNodeContext): ConversationLocation {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
}

// ── Global Panel State ──────────────────────────────────────────────────────

let panelVisible = false
let panelPath = ''
const listeners = new Set<() => void>()
function notifyListeners(): void { for (const fn of listeners) fn() }

const artifactPanel = {
  open(path: string): void { panelPath = path; panelVisible = true; notifyListeners() },
  close(): void { panelVisible = false; notifyListeners() },
}

function usePanelState(): { visible: boolean; path: string } {
  const [, forceUpdate] = useState(0)
  useEffect(() => {
    const cb = (): void => { forceUpdate(n => n + 1) }
    listeners.add(cb)
    return () => { listeners.delete(cb) }
  }, [])
  return { visible: panelVisible, path: panelPath }
}

// ── ConversationNodeDefinition ──────────────────────────────────────────────

/**
 * One previewable artifact write, correlated from its `tool/call` (which
 * carries the `file_path`) to its `tool/result` (which settles success).
 *
 * Both events carry the same `callId`, so that is the Definition-local id: the
 * call opens the Context, the result flips `settled`. A result whose call was
 * not previewable never matches, so no Context is opened for it.
 */
const artifactDefinition: ConversationNodeDefinition<ArtifactState> = {
  kind: 'artifact-preview',
  target: 'chat',

  match(event) {
    const data = event.data as Record<string, unknown>
    if (event.type === 'tool/call') {
      if (callPreviewPath(data) === undefined) return null
      const callId = data['callId']
      if (typeof callId !== 'string') return null
      return { id: callId, role: 'start' }
    }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      const callId = resultCallId(data)
      // Unknown callIds are filtered by the engine: no Context, no update.
      return callId === undefined ? null : { id: callId, role: 'update' }
    }
    return null
  },

  start(_context, match) {
    if (match.event.type !== 'tool/call') throw new Error('artifact-preview requires tool/call as its start')
    const data = match.event.data as Record<string, unknown>
    return {
      turn: (data['turn'] as number | undefined) ?? 0,
      step: (data['step'] as number | undefined) ?? 0,
      path: callPreviewPath(data) ?? '',
      seq: match.event.seq,
      settled: false,
      failed: false,
    }
  },

  update(context, match) {
    if (match.event.type !== 'tool/result') return context.state
    const data = match.event.data as Record<string, unknown>
    return { ...context.state, settled: true, failed: resultIsError(data) }
  },

  buildLocationData(context, scope) {
    if (scope !== 'step' || context.state === undefined) return null
    return {
      kind: 'step',
      turn: context.state.turn,
      step: context.state.step,
      key: 'artifact-preview',
      value: {
        path: context.state.path,
        fileName: fileBasename(context.state.path),
        ext: fileExt(context.state.path),
      },
    }
  },

  buildViewNode(context) {
    if (context.state === undefined) return null
    // The button offers to OPEN a file: withhold it until the write settled,
    // and drop it when the write failed (there is nothing to preview).
    const ready = context.state.settled && !context.state.failed
    return {
      key: context.key,
      kind: 'artifact-preview',
      id: context.id,
      target: 'chat',
      anchorSeq: context.state.seq,
      location: locationOf(context),
      visibility: ready ? 'visible' : 'hidden',
      data: {
        path: context.state.path,
        fileName: fileBasename(context.state.path),
        ext: fileExt(context.state.path),
      },
    }
  },
}

// ── Chat Node Component ─────────────────────────────────────────────────────

function ArtifactButtonNode({ node }: ChatNodeViewProps<'artifact-preview'>) {
  const openPreview = useCallback(() => {
    artifactPanel.open(node.data.path)
  }, [node.data.path])

  return createElement('div', {
    onClick: openPreview,
    style: {
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      margin: '4px 0', padding: '5px 12px', borderRadius: '6px',
      border: '1px solid var(--dsw-border-color, #d0d7de)',
      background: 'var(--dsw-surface-subtle, #f6f8fa)',
      cursor: 'pointer', fontSize: '12px',
      color: 'var(--dsw-text-secondary, #656d76)', userSelect: 'none' as const,
    },
  },
    createElement('span', null, '🎨'),
    createElement('span', null, 'Open Preview'),
    createElement('span', { style: {
      fontSize: '10px', padding: '1px 5px', borderRadius: '3px',
      background: 'var(--dsw-accent-subtle, #ddf4ff)',
      color: 'var(--dsw-accent, #0969da)', fontWeight: 500,
    } }, node.data.ext),
  )
}

// ── Shell Overlay: Right-side Panel ─────────────────────────────────────────

/** Panel width bounds in px: narrower than MIN is unusable, wider starves the conversation. */
const WIDTH_MIN = 320
const WIDTH_MAX_RATIO = 0.8
/** Default share of the viewport, capped so it does not dominate a wide screen. */
const WIDTH_DEFAULT_RATIO = 0.45
const WIDTH_DEFAULT_CAP = 700
/** Where the dragged width survives a reload. */
const WIDTH_STORAGE_KEY = 'dsh.artifactPreview.width'

/** Clamp a candidate width into the bounds the current viewport allows. */
function clampWidth(px: number): number {
  const max = Math.max(WIDTH_MIN, window.innerWidth * WIDTH_MAX_RATIO)
  return Math.round(Math.min(max, Math.max(WIDTH_MIN, px)))
}

/** The width a panel opens at when the user has not dragged one. */
function defaultWidth(): number {
  return clampWidth(Math.min(WIDTH_DEFAULT_CAP, window.innerWidth * WIDTH_DEFAULT_RATIO))
}

/**
 * Width to open at: the persisted drag, else the default. A stored value is
 * re-clamped because the viewport may have shrunk since it was written.
 */
function storedWidth(): number {
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(WIDTH_STORAGE_KEY)
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); the default
    // is a complete answer, so treat it as "nothing stored".
    return defaultWidth()
  }
  if (raw === null) return defaultWidth()
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? clampWidth(parsed) : defaultWidth()
}

/** Persist a dragged width; a storage failure must not break the gesture. */
function persistWidth(px: number): void {
  try {
    window.localStorage.setItem(WIDTH_STORAGE_KEY, String(px))
  } catch {
    // Same unavailable-storage case as storedWidth(): the width still applies
    // for this session, it just will not survive a reload.
  }
}

/**
 * The panel's left edge as a resize grip.
 *
 * Mirrors ui-layout's own DragHandle contract: pointer capture keeps the drag
 * alive when the pointer outruns the 6px strip, reports are coalesced to one
 * per animation frame, and the caller freezes its base width at `onStart` so
 * deltas measure from the gesture origin instead of compounding.
 */
function ResizeGrip(props: {
  onStart: () => void
  onDrag: (dx: number) => void
  onEnd: () => void
  onReset: () => void
}) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  // Re-read handlers every render so a stale closure cannot resize to an old base.
  const callbacks = useRef(props)
  callbacks.current = props

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    origin.current = e.clientX
    latest.current = e.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    callbacks.current.onDrag(latest.current - origin.current)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])

  return createElement('div', {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onDoubleClick: () => { callbacks.current.onReset() },
    title: 'Drag to resize · double-click to reset',
    style: {
      position: 'absolute' as const,
      top: 0, left: 0, bottom: 0,
      width: '6px',
      marginLeft: '-3px',
      cursor: 'col-resize',
      // touch-action keeps a touch drag from scrolling the page instead.
      touchAction: 'none' as const,
      zIndex: 1,
      background: dragging ? 'var(--dsw-accent, #0969da)' : 'transparent',
      opacity: dragging ? 0.35 : 1,
    },
  })
}

function ArtifactPanel() {
  const { visible, path } = usePanelState()
  const [width, setWidth] = useState(storedWidth)
  const [dragging, setDragging] = useState(false)
  // Frozen at pointerdown: a mid-gesture re-render must not move the origin.
  const dragBase = useRef(width)

  // Reopening after a reload picks up the persisted width; the viewport may
  // have changed while the panel was closed, so re-clamp on each open.
  useEffect(() => {
    if (visible) setWidth(storedWidth())
  }, [visible])

  // The window can shrink below a previously legal width while the panel is open.
  useEffect(() => {
    if (!visible) return
    const onResize = (): void => { setWidth(w => clampWidth(w)) }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [visible])

  // Sidebar keeps its own width; the conversation column absorbs the change,
  // which is exactly what shrinking #root does (the sidebar track is fixed).
  useEffect(() => {
    const root = document.getElementById('root')
    if (root === null) return
    if (visible) {
      root.style.width = `calc(100vw - ${String(width)}px)`
      // Easing the track would detach the panel edge from the pointer, so the
      // transition is only present when the width changes for another reason.
      root.style.transition = dragging ? 'none' : 'width 0.2s ease'
      root.style.overflow = 'hidden'
    } else {
      root.style.width = ''
      root.style.transition = ''
      root.style.overflow = ''
    }
    return () => {
      root.style.width = ''
      root.style.transition = ''
      root.style.overflow = ''
    }
  }, [visible, width, dragging])

  const onStart = useCallback(() => {
    setDragging(true)
    setWidth((w) => { dragBase.current = w; return w })
  }, [])
  // The grip sits on the LEFT edge: dragging left (negative dx) widens the panel.
  const onDrag = useCallback((dx: number) => { setWidth(clampWidth(dragBase.current - dx)) }, [])
  const onEnd = useCallback(() => {
    setDragging(false)
    setWidth((w) => { persistWidth(w); return w })
  }, [])
  const onReset = useCallback(() => {
    const next = defaultWidth()
    setWidth(next)
    persistWidth(next)
  }, [])

  if (!visible) return null

  const previewUrl = `/preview/${encodeURIComponent(path)}`
  const fileName = path.includes('/') ? path.split('/').pop()! : path
  const ext = fileExt(path)

  const btnSt = { fontSize: '14px', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--dsw-border-color, #d0d7de)', background: 'transparent', cursor: 'pointer', color: 'var(--dsw-text-secondary, #656d76)' }

  return createElement('div', {
    style: {
      position: 'fixed' as const, top: 0, right: 0,
      width: `${String(width)}px`, height: '100vh',
      background: 'var(--dsw-surface-bg, #fff)',
      borderLeft: '1px solid var(--dsw-border-color, #d0d7de)',
      boxShadow: '-2px 0 8px rgba(0,0,0,0.06)',
      zIndex: 100, display: 'flex', flexDirection: 'column' as const,
      fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
      transition: dragging ? 'none' : 'width 0.2s ease',
    },
  },
    createElement(ResizeGrip, { key: 'grip', onStart, onDrag, onEnd, onReset }),
    createElement('div', { key: 'header', style: {
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '12px 16px',
      borderBottom: '1px solid var(--dsw-border-color, #d0d7de)',
      background: 'var(--dsw-surface-subtle, #f6f8fa)',
      flexShrink: 0, userSelect: 'none' as const,
    } },
      createElement('span', { style: { fontSize: '16px' } }, '🎨'),
      createElement('span', { style: { flex: 1, fontSize: '13px', fontWeight: 600, color: 'var(--dsw-text-primary, #1f2328)' } }, fileName),
      createElement('span', { style: { fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: 'var(--dsw-accent-subtle, #ddf4ff)', color: 'var(--dsw-accent, #0969da)', fontWeight: 500 } }, ext),
      createElement('button', { title: 'Refresh', onClick: () => { artifactPanel.open(path) }, style: btnSt }, '↻'),
      createElement('button', { title: 'Open in new tab', onClick: () => { window.open(previewUrl, '_blank') }, style: btnSt }, '↗'),
      createElement('button', { title: 'Close', onClick: () => { artifactPanel.close() }, style: btnSt }, '✕'),
    ),
    createElement('iframe', {
      key: path,
      src: previewUrl,
      sandbox: 'allow-scripts allow-forms allow-popups',
      style: {
        flex: 1, width: '100%', border: 'none', background: '#fff',
        // A drag must not be swallowed by the iframe once the pointer crosses it.
        pointerEvents: dragging ? 'none' as const : 'auto' as const,
      },
      title: `Preview: ${fileName}`,
    }),
  )
}

// ── Plugin Apply ────────────────────────────────────────────────────────────

export const inject = ['conversationEvents', 'slots']

export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(artifactDefinition)

  // Keyed Chat renderer: `locale` seats the framework-synthesized `t` prop that
  // ChatNodeViewProps requires.
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'artifact-preview',
    locale: 'conversation',
  }, ArtifactButtonNode))

  // `shell.overlay` is a LIST slot: `id` is mandatory (ui-slots rejects a list
  // registration without one at apply time, which fails the whole boot).
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'artifact-preview',
    order: 50,
  }, ArtifactPanel))
}
