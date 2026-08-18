/**
 * Artifact Preview plugin, browser half.
 *
 * Three contributions:
 *
 * 1. The Conversation Node Definition (`./artifact-definition.ts`) that spots
 *    previewable writes in the event stream.
 * 2. A keyed Chat renderer: the **Open Preview** button on a settled write.
 * 3. A `shell.overlay` entry: the resizable side panel and its iframe.
 *
 * The panel is DOM-scoped state rather than a slot store: it is one frame-wide
 * surface with no session identity, and the width it applies to `#root` is a
 * page-level effect the slot system does not model.
 * @module
 */
import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { artifactDefinition, ARTIFACT_KIND } from './artifact-definition.ts'
import { fileBasename, fileExt } from './artifact-events.ts'
import {
  clampWidth, defaultWidth, readStoredWidth, widthForDrag, writeStoredWidth,
  type WidthStorage,
} from './panel-width.ts'

/**
 * `shell.overlay` is declared by `@deepseek-ai/dsh-client-ui-layout`, which
 * ships no npm package, so its SlotMap entry is restated here rather than
 * imported. Declaration merging makes this additive: with the layout package
 * present both declarations describe the same slot, and the runtime spec always
 * comes from the declaring plugin, never from this line.
 *
 * The slot is a frame-wide floating layer above every column: `kind: 'list'`
 * (so a registration MUST carry an `id`) at `scope: 'root'`.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'shell.overlay': { kind: 'list', scope: 'root' }
  }
}

// ── Panel state ─────────────────────────────────────────────────────────────

/**
 * Which artifact the panel shows, and whether it is open.
 *
 * The session id travels with the path because the preview route is
 * session-scoped: the file resolves against the SESSION's working directory, and
 * the panel's own slot is root-scoped, so the framework hands it no session id.
 * The button supplies it, since its slot has session scope.
 */
interface PanelState {
  readonly visible: boolean
  readonly path: string
  readonly sessionId: string
}

let panelState: PanelState = { visible: false, path: '', sessionId: '' }
const listeners = new Set<() => void>()

/** The panel controller the button drives; module-scoped because the panel is a singleton surface. */
const artifactPanel = {
  open(path: string, sessionId: string): void {
    panelState = { visible: true, path, sessionId }
    for (const notify of listeners) notify()
  },
  close(): void {
    panelState = { ...panelState, visible: false }
    for (const notify of listeners) notify()
  },
}

/** Subscribe a component to panel state. */
function usePanelState(): PanelState {
  const [state, setState] = useState(panelState)
  useEffect(() => {
    const sync = (): void => { setState(panelState) }
    listeners.add(sync)
    // State can have moved between render and subscribe.
    sync()
    return () => { listeners.delete(sync) }
  }, [])
  return state
}

/** The storage face, or undefined where it is unavailable (private mode, blocked). */
function widthStorage(): WidthStorage | undefined {
  try {
    return window.localStorage
  } catch {
    // Merely touching localStorage throws under some blocking policies.
    return undefined
  }
}

// ── Chat button ─────────────────────────────────────────────────────────────

/**
 * The Open Preview row shown under a settled previewable write.
 *
 * `sessionId` is a framework-standard prop of a session-scoped slot, and this is
 * where it enters the feature: the panel's slot is root-scoped and receives no
 * session id, so the button carries it across.
 */
function ArtifactButtonNode({ node, sessionId }: ChatNodeViewProps<'artifact-preview'>) {
  const path = node.data.path
  const openPreview = useCallback(() => {
    artifactPanel.open(path, sessionId)
  }, [path, sessionId])

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
    createElement('span', { key: 'icon' }, '🎨'),
    createElement('span', { key: 'label' }, 'Open Preview'),
    createElement('span', {
      key: 'badge',
      style: {
        fontSize: '10px', padding: '1px 5px', borderRadius: '3px',
        background: 'var(--dsw-accent-subtle, #ddf4ff)',
        color: 'var(--dsw-accent, #0969da)', fontWeight: 500,
      },
    }, node.data.ext),
  )
}

// ── Resize grip ─────────────────────────────────────────────────────────────

/**
 * The panel's left edge as a resize grip.
 *
 * Mirrors ui-layout's own DragHandle contract: pointer capture keeps the drag
 * alive when the pointer outruns the narrow strip, reports are coalesced to one
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
  // Re-read handlers every render so a stale closure cannot resize from an old base.
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
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
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
      // Without this a touch drag scrolls the page instead of resizing.
      touchAction: 'none' as const,
      zIndex: 1,
      background: dragging ? 'var(--dsw-accent, #0969da)' : 'transparent',
      opacity: dragging ? 0.35 : 1,
    },
  })
}

// ── Side panel ──────────────────────────────────────────────────────────────

/** Header button styling, shared by the three actions. */
const ACTION_STYLE = {
  fontSize: '14px', padding: '4px 8px', borderRadius: '4px',
  border: '1px solid var(--dsw-border-color, #d0d7de)',
  background: 'transparent', cursor: 'pointer',
  color: 'var(--dsw-text-secondary, #656d76)',
} as const

/** The resizable preview panel, pinned to the right edge of the frame. */
function ArtifactPanel() {
  const { visible, path, sessionId } = usePanelState()
  const [width, setWidth] = useState(() => readStoredWidth(widthStorage(), window.innerWidth))
  const [dragging, setDragging] = useState(false)
  // Frozen at pointerdown so a mid-gesture re-render cannot move the origin.
  const dragBase = useRef(width)

  // Reopening picks up the persisted width; the viewport may have changed while
  // the panel was closed, so the stored value is re-clamped on each open.
  useEffect(() => {
    if (visible) setWidth(readStoredWidth(widthStorage(), window.innerWidth))
  }, [visible])

  // The window can shrink below a previously legal width while the panel is open.
  useEffect(() => {
    if (!visible) return
    const onResize = (): void => { setWidth(w => clampWidth(w, window.innerWidth)) }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [visible])

  // The sidebar keeps its own width, so shrinking #root takes the space from the
  // conversation column: that is the intended split.
  useEffect(() => {
    const root = document.getElementById('root')
    if (root === null) return
    if (visible) {
      root.style.width = `calc(100vw - ${String(width)}px)`
      // Easing the track would detach the panel edge from the pointer, so the
      // transition applies only when the width moves for another reason.
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
  const onDrag = useCallback((dx: number) => {
    setWidth(widthForDrag(dragBase.current, dx, window.innerWidth))
  }, [])
  const onEnd = useCallback(() => {
    setDragging(false)
    setWidth((w) => { writeStoredWidth(widthStorage(), w); return w })
  }, [])
  const onReset = useCallback(() => {
    const next = defaultWidth(window.innerWidth)
    setWidth(next)
    writeStoredWidth(widthStorage(), next)
  }, [])

  if (!visible) return null

  // Session-scoped: the host resolves the file against THIS session's working
  // directory, which is what makes a preview work when `dsh web` was launched
  // from somewhere other than the workspace.
  const previewUrl = `/preview/${encodeURIComponent(sessionId)}/${encodeURIComponent(path)}`
  const fileName = fileBasename(path)

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
    createElement('div', {
      key: 'header',
      style: {
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '12px 16px',
        borderBottom: '1px solid var(--dsw-border-color, #d0d7de)',
        background: 'var(--dsw-surface-subtle, #f6f8fa)',
        flexShrink: 0, userSelect: 'none' as const,
      },
    },
      createElement('span', { key: 'icon', style: { fontSize: '16px' } }, '🎨'),
      createElement('span', {
        key: 'name',
        style: { flex: 1, fontSize: '13px', fontWeight: 600, color: 'var(--dsw-text-primary, #1f2328)' },
      }, fileName),
      createElement('span', {
        key: 'badge',
        style: {
          fontSize: '11px', padding: '2px 6px', borderRadius: '4px',
          background: 'var(--dsw-accent-subtle, #ddf4ff)',
          color: 'var(--dsw-accent, #0969da)', fontWeight: 500,
        },
      }, fileExt(path)),
      createElement('button', {
        key: 'refresh', title: 'Refresh', style: ACTION_STYLE,
        onClick: () => { artifactPanel.open(path, sessionId) },
      }, '↻'),
      createElement('button', {
        key: 'external', title: 'Open in new tab', style: ACTION_STYLE,
        onClick: () => { window.open(previewUrl, '_blank') },
      }, '↗'),
      createElement('button', {
        key: 'close', title: 'Close', style: ACTION_STYLE,
        onClick: () => { artifactPanel.close() },
      }, '✕'),
    ),
    createElement('iframe', {
      // Keying by path remounts the frame on a switch, so a refresh of the same
      // artifact reloads rather than reusing a stale document.
      key: path,
      src: previewUrl,
      // No allow-same-origin: previewed content stays in an opaque origin and
      // cannot reach the harness page's DOM, storage, or cookies.
      sandbox: 'allow-scripts allow-forms allow-popups',
      style: {
        flex: 1, width: '100%', border: 'none', background: '#fff',
        // Without this the iframe swallows the drag once the pointer crosses it.
        pointerEvents: dragging ? 'none' as const : 'auto' as const,
      },
      title: `Preview: ${fileName}`,
    }),
  )
}

// ── Plugin ──────────────────────────────────────────────────────────────────

/** Services required for the Definition and both slot registrations. */
export const inject = ['conversationEvents', 'slots']

/**
 * Register the Definition, the Chat button, and the overlay panel.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(artifactDefinition)

  // `locale` seats the framework-synthesized `t` prop ChatNodeViewProps requires.
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: ARTIFACT_KIND,
    locale: 'conversation',
  }, ArtifactButtonNode))

  // `shell.overlay` is a LIST slot: omitting `id` is rejected at apply time,
  // which fails the whole client tree at boot.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: ARTIFACT_KIND,
    order: 50,
  }, ArtifactPanel))
}
