/**
 * The Conversation Node Definition for previewable artifact writes.
 *
 * One Context per mutation call, keyed by `callId`: the `tool/call` opens it and
 * carries the path, the paired `tool/result` settles it. Kept out of the plugin
 * entry so the correlation can be replayed against recorded events without a
 * React renderer or a live slot registry.
 * @module
 */
import type {
  ConversationLocation, ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-client-runtime/client'
import {
  callId, callPreviewPath, coordinate, fileBasename, fileExt, resultCallId, resultIsError,
} from './artifact-events.ts'

/** Accumulated state of one artifact write. */
export interface ArtifactState {
  readonly turn: number
  readonly step: number
  readonly path: string
  /** Log position of the opening call; the Node's durable anchor. */
  readonly seq: number
  /** The paired `tool/result` arrived. */
  readonly settled: boolean
  /** The settled result reported failure, so there is no file to preview. */
  readonly failed: boolean
}

/** Renderer-facing payload of one artifact Node. */
export interface ArtifactChatData {
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

/** Node kind and Step-data key this Definition owns. */
export const ARTIFACT_KIND = 'artifact-preview'

/** Renderer payload derived from accumulated state. */
function viewData(state: ArtifactState): ArtifactChatData {
  return { path: state.path, fileName: fileBasename(state.path), ext: fileExt(state.path) }
}

/** Location of a Context, falling back to unresolved before one is known. */
function locationOf(context: ConversationNodeContext): ConversationLocation {
  /* v8 ignore next -- reaching the unresolved arm needs a Context with neither a
  start nor any match, which the engine never hands to buildViewNode. Kept
  because the field is required and a wrong location misplaces the row. */
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
}

/**
 * Correlate previewable writes into one Node each.
 *
 * `match` reads only the current event, as the engine requires: a `tool/call`
 * that writes something previewable opens a Context under its own `callId`, and
 * a `tool/result` updates the Context with the same id. A result whose call was
 * never previewable names no Context, and the engine drops it.
 */
export const artifactDefinition: ConversationNodeDefinition<ArtifactState> = {
  kind: ARTIFACT_KIND,
  target: 'chat',

  match(event) {
    const data = event.data as Record<string, unknown>
    if (event.type === 'tool/call') {
      if (callPreviewPath(data) === undefined) return null
      const id = callId(data)
      return id === undefined ? null : { id, role: 'start' }
    }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      const id = resultCallId(data)
      return id === undefined ? null : { id, role: 'update' }
    }
    return null
  },

  start(_context, match) {
    if (match.event.type !== 'tool/call') {
      throw new Error(`${ARTIFACT_KIND} requires tool/call as its start`)
    }
    const data = match.event.data as Record<string, unknown>
    return {
      turn: coordinate(data, 'turn'),
      step: coordinate(data, 'step'),
      /* v8 ignore next -- match() already required a previewable path on this
      exact payload, so the fallback cannot be reached; it satisfies the
      non-optional field without asserting non-null. */
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
      key: ARTIFACT_KIND,
      value: viewData(context.state),
    }
  },

  buildViewNode(context) {
    if (context.state === undefined) return null
    // The button offers to OPEN a file, so it stays hidden until the write
    // settled, and a failed write leaves nothing to preview. The Node is kept
    // (hidden) rather than withdrawn, because a published key must not vanish.
    const ready = context.state.settled && !context.state.failed
    return {
      key: context.key,
      kind: ARTIFACT_KIND,
      id: context.id,
      target: 'chat',
      anchorSeq: context.state.seq,
      location: locationOf(context),
      visibility: ready ? 'visible' : 'hidden',
      data: viewData(context.state),
    }
  },
}
