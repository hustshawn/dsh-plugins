/**
 * Panel width arithmetic: the bounds, the default, and what a drag produces.
 *
 * The grip is the panel's LEFT edge, so the sign of `dx` is the part most easily
 * inverted, and a compounding base is the classic drag defect. Both are pinned
 * here.
 */
import { describe, expect, it } from 'vitest'
import {
  clampWidth, defaultWidth, readStoredWidth, widthForDrag, WIDTH_DEFAULT_CAP,
  WIDTH_MAX_RATIO, WIDTH_MIN, WIDTH_STORAGE_KEY, writeStoredWidth,
  type WidthStorage,
} from '../src/client/panel-width.ts'

const WIDE = 1600
const NARROW = 900

/** An in-memory storage face. */
function memoryStorage(initial?: string): WidthStorage & { readonly written: string[] } {
  const written: string[] = []
  let value = initial ?? null
  return {
    written,
    getItem: () => value,
    setItem: (_key, next) => { value = next; written.push(next) },
  }
}

/** A storage face that throws on both operations. */
function hostileStorage(): WidthStorage {
  return {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('quota') },
  }
}

describe('clampWidth', () => {
  it('passes a width already inside the bounds through, rounded', () => {
    expect(clampWidth(500.4, WIDE)).toBe(500)
  })

  it('raises a width below the minimum', () => {
    expect(clampWidth(10, WIDE)).toBe(WIDTH_MIN)
  })

  it('lowers a width above the viewport ratio', () => {
    expect(clampWidth(5000, WIDE)).toBe(Math.round(WIDE * WIDTH_MAX_RATIO))
  })

  it('keeps the minimum even on a viewport narrower than it', () => {
    // A panel collapsed below the minimum is unusable; showing the minimum and
    // letting it overhang is the better answer.
    expect(clampWidth(100, 380)).toBe(WIDTH_MIN)
    expect(clampWidth(5000, 380)).toBe(WIDTH_MIN)
  })

  it('re-clamps a width that a viewport change made illegal', () => {
    const wide = clampWidth(1200, WIDE)
    expect(wide).toBe(1200)
    expect(clampWidth(wide, NARROW)).toBe(Math.round(NARROW * WIDTH_MAX_RATIO))
  })

  it('always returns an integer, since the value becomes a px length', () => {
    for (const px of [321.5, 499.99, 700.5]) {
      expect(Number.isInteger(clampWidth(px, WIDE))).toBe(true)
    }
  })
})

describe('defaultWidth', () => {
  it('is capped on a wide viewport', () => {
    // 45% of 1600 is 720, above the cap.
    expect(defaultWidth(WIDE)).toBe(WIDTH_DEFAULT_CAP)
  })

  it('is a share of the viewport when that is below the cap', () => {
    expect(defaultWidth(NARROW)).toBe(Math.round(NARROW * 0.45))
  })

  it('never falls below the minimum', () => {
    expect(defaultWidth(400)).toBe(WIDTH_MIN)
  })

  it('is itself a legal width', () => {
    for (const viewport of [380, 640, NARROW, WIDE, 3840]) {
      const value = defaultWidth(viewport)
      expect(clampWidth(value, viewport)).toBe(value)
    }
  })
})

describe('widthForDrag', () => {
  it('widens when the pointer moves left, because the grip is the left edge', () => {
    expect(widthForDrag(700, -200, WIDE)).toBe(900)
  })

  it('narrows when the pointer moves right', () => {
    expect(widthForDrag(700, 200, WIDE)).toBe(500)
  })

  it('returns the base for no movement', () => {
    expect(widthForDrag(700, 0, WIDE)).toBe(700)
  })

  it('does not compound across reports from one gesture', () => {
    // Every report measures from the frozen base, so the same dx is idempotent.
    expect(widthForDrag(700, -50, WIDE)).toBe(widthForDrag(700, -50, WIDE))
    expect(widthForDrag(700, -50, WIDE)).toBe(750)
  })

  it('stops at the minimum however far right the pointer goes', () => {
    expect(widthForDrag(700, 100_000, WIDE)).toBe(WIDTH_MIN)
  })

  it('stops at the ratio ceiling however far left the pointer goes', () => {
    expect(widthForDrag(700, -100_000, WIDE)).toBe(Math.round(WIDE * WIDTH_MAX_RATIO))
  })

  it('tracks a gesture monotonically', () => {
    const widths = [0, -50, -100, -150, -200].map(dx => widthForDrag(700, dx, WIDE))
    const ascending = [...widths].sort((a, b) => a - b)
    expect(widths).toEqual(ascending)
  })
})

describe('readStoredWidth', () => {
  it('returns the default when nothing is stored', () => {
    expect(readStoredWidth(memoryStorage(), WIDE)).toBe(defaultWidth(WIDE))
  })

  it('returns a stored width', () => {
    expect(readStoredWidth(memoryStorage('880'), WIDE)).toBe(880)
  })

  it('re-clamps a stored width the current viewport cannot honour', () => {
    expect(readStoredWidth(memoryStorage('1400'), NARROW)).toBe(Math.round(NARROW * WIDTH_MAX_RATIO))
  })

  it.each([
    ['not a number', 'wide'],
    ['empty', ''],
    ['zero', '0'],
    ['negative', '-500'],
    ['infinite', 'Infinity'],
  ])('falls back to the default for a %s value', (_name, stored) => {
    expect(readStoredWidth(memoryStorage(stored), WIDE)).toBe(defaultWidth(WIDE))
  })

  it('falls back to the default when storage is unavailable', () => {
    expect(readStoredWidth(undefined, WIDE)).toBe(defaultWidth(WIDE))
  })

  it('falls back to the default when reading throws', () => {
    // A blocked store must still yield a working panel.
    expect(() => readStoredWidth(hostileStorage(), WIDE)).not.toThrow()
    expect(readStoredWidth(hostileStorage(), WIDE)).toBe(defaultWidth(WIDE))
  })
})

describe('writeStoredWidth', () => {
  it('persists under the documented key', () => {
    const storage = memoryStorage()
    writeStoredWidth(storage, 880)
    expect(storage.written).toEqual(['880'])
    expect(WIDTH_STORAGE_KEY).toBe('dsh.artifactPreview.width')
  })

  it('round-trips through a read', () => {
    const storage = memoryStorage()
    writeStoredWidth(storage, 880)
    expect(readStoredWidth(storage, WIDE)).toBe(880)
  })

  it('does nothing when storage is unavailable', () => {
    expect(() => { writeStoredWidth(undefined, 880) }).not.toThrow()
  })

  it('swallows a write failure, since only persistence is lost', () => {
    expect(() => { writeStoredWidth(hostileStorage(), 880) }).not.toThrow()
  })
})
