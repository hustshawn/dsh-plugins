/**
 * Panel width rules: bounds, the default, drag arithmetic, and persistence.
 *
 * Kept free of React and of the DOM (the viewport width and the storage face are
 * passed in) so the arithmetic a user feels while dragging is directly testable.
 * @module
 */

/** Narrower than this the panel cannot show a page usefully. */
export const WIDTH_MIN = 320
/** Beyond this share of the viewport the conversation is starved. */
export const WIDTH_MAX_RATIO = 0.8
/** Opening share of the viewport. */
export const WIDTH_DEFAULT_RATIO = 0.45
/** Cap on the default so a wide monitor does not hand the panel half the screen. */
export const WIDTH_DEFAULT_CAP = 700
/** Key the dragged width is persisted under. */
export const WIDTH_STORAGE_KEY = 'dsh.artifactPreview.width'

/** The subset of `Storage` this module uses; both methods may throw. */
export interface WidthStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * Clamp a candidate width into the bounds the viewport allows.
 *
 * `WIDTH_MIN` wins over the ratio ceiling: on a viewport narrower than the
 * minimum the panel is still shown at its minimum rather than collapsed to
 * something unusable.
 * @param px - Candidate width in px.
 * @param viewportWidth - Current viewport width in px.
 * @returns An integer width within bounds.
 */
export function clampWidth(px: number, viewportWidth: number): number {
  const max = Math.max(WIDTH_MIN, viewportWidth * WIDTH_MAX_RATIO)
  return Math.round(Math.min(max, Math.max(WIDTH_MIN, px)))
}

/**
 * The width a panel opens at when the user has not dragged one.
 * @param viewportWidth - Current viewport width in px.
 * @returns The clamped default width.
 */
export function defaultWidth(viewportWidth: number): number {
  return clampWidth(Math.min(WIDTH_DEFAULT_CAP, viewportWidth * WIDTH_DEFAULT_RATIO), viewportWidth)
}

/**
 * Width to open at: the persisted drag when usable, else the default.
 *
 * A stored value is re-clamped because the viewport may have shrunk since it was
 * written, and unreadable storage falls back to the default rather than failing —
 * a private-mode browser still gets a working panel.
 * @param storage - Storage face, or undefined when unavailable.
 * @param viewportWidth - Current viewport width in px.
 * @returns The width to render at.
 */
export function readStoredWidth(storage: WidthStorage | undefined, viewportWidth: number): number {
  if (storage === undefined) return defaultWidth(viewportWidth)
  let raw: string | null
  try {
    raw = storage.getItem(WIDTH_STORAGE_KEY)
  } catch {
    // Storage access itself can throw when blocked; the default is complete.
    return defaultWidth(viewportWidth)
  }
  if (raw === null) return defaultWidth(viewportWidth)
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultWidth(viewportWidth)
  return clampWidth(parsed, viewportWidth)
}

/**
 * Persist a width, ignoring a storage failure.
 *
 * A failed write costs only persistence across reloads, so it must not surface
 * as an error in the middle of a drag.
 * @param storage - Storage face, or undefined when unavailable.
 * @param px - Width to remember.
 */
export function writeStoredWidth(storage: WidthStorage | undefined, px: number): void {
  if (storage === undefined) return
  try {
    storage.setItem(WIDTH_STORAGE_KEY, String(px))
  } catch {
    // Quota or a blocked store; the width still applies for this session.
  }
}

/**
 * Width for a drag in progress.
 *
 * The grip is the panel's LEFT edge, so moving left (negative `dx`) makes the
 * panel wider. `base` is the width frozen when the gesture started, so repeated
 * reports from one gesture cannot compound.
 * @param base - Width at gesture start, in px.
 * @param dx - Pointer movement since gesture start, in px.
 * @param viewportWidth - Current viewport width in px.
 * @returns The clamped width for this pointer position.
 */
export function widthForDrag(base: number, dx: number, viewportWidth: number): number {
  return clampWidth(base - dx, viewportWidth)
}
