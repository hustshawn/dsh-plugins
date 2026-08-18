/**
 * Preview path resolution: which requests name a readable file, and which are
 * refused. Containment here is a security property, so the escape attempts are
 * as much the subject as the happy paths.
 */
import { describe, expect, it } from 'vitest'
import { join, sep } from 'node:path'
import { previewPathFromUrl, resolvePreviewTarget } from '../src/preview-path.ts'

const ROOT = sep === '\\' ? 'C:\\workspace' : '/workspace'

describe('resolvePreviewTarget', () => {
  it('resolves a workspace-relative path under the root', () => {
    const result = resolvePreviewTarget('docs/a.md', ROOT)
    expect(result).toEqual({ kind: 'file', target: join(ROOT, 'docs', 'a.md') })
  })

  it('resolves an absolute path inside the root as itself', () => {
    // Tools report model-facing paths, which are absolute; this is the common case.
    const abs = join(ROOT, 'docs', 'a.md')
    expect(resolvePreviewTarget(abs, ROOT)).toEqual({ kind: 'file', target: abs })
  })

  it('does not concatenate an absolute request onto the root', () => {
    // The original defect: `${root}/${abs}` resolved to a path that exists
    // nowhere, so every tool-reported path answered 404.
    const abs = join(ROOT, 'a.html')
    const result = resolvePreviewTarget(abs, ROOT)
    expect(result).toEqual({ kind: 'file', target: abs })
    if (result.kind === 'file') {
      expect(result.target).not.toContain(`${ROOT}${ROOT}`)
    }
  })

  it('reports an empty request as naming no path', () => {
    expect(resolvePreviewTarget('', ROOT)).toEqual({ kind: 'missing-path' })
  })

  it('allows the root itself', () => {
    expect(resolvePreviewTarget('.', ROOT)).toEqual({ kind: 'file', target: ROOT })
  })

  it.each([
    ['relative traversal', '../secret.md'],
    ['deep relative traversal', '../../../../etc/passwd'],
    ['traversal through a real subdirectory', 'docs/../../secret.md'],
  ])('denies %s', (_name, requested) => {
    expect(resolvePreviewTarget(requested, ROOT)).toEqual({ kind: 'denied' })
  })

  it('denies an absolute path outside the root', () => {
    const outside = sep === '\\' ? 'C:\\Windows\\system.ini' : '/etc/passwd'
    expect(resolvePreviewTarget(outside, ROOT)).toEqual({ kind: 'denied' })
  })

  it('denies a sibling directory whose name merely starts with the root name', () => {
    // `/workspace-other` must not pass a naive startsWith(root) check.
    expect(resolvePreviewTarget(`${ROOT}-other${sep}a.md`, ROOT)).toEqual({ kind: 'denied' })
  })

  it('resolves a path that returns to the root after traversal', () => {
    const result = resolvePreviewTarget('docs/../a.md', ROOT)
    expect(result).toEqual({ kind: 'file', target: join(ROOT, 'a.md') })
  })
})

describe('previewPathFromUrl', () => {
  it('extracts the path after the route prefix', () => {
    expect(previewPathFromUrl('/preview/docs/a.md')).toBe('docs/a.md')
  })

  it('decodes a percent-encoded path', () => {
    expect(previewPathFromUrl(`/preview/${encodeURIComponent('/abs/my file.md')}`))
      .toBe('/abs/my file.md')
  })

  it('ignores a query string', () => {
    expect(previewPathFromUrl('/preview/a.md?t=123')).toBe('a.md')
  })

  it('returns empty for the bare prefix', () => {
    expect(previewPathFromUrl('/preview/')).toBe('')
  })

  it('returns empty for a URL outside this route', () => {
    expect(previewPathFromUrl('/other/a.md')).toBe('')
  })

  it('returns empty for a malformed escape instead of throwing', () => {
    // A lone '%' makes decodeURIComponent throw; the route must still answer.
    expect(() => previewPathFromUrl('/preview/%')).not.toThrow()
    expect(previewPathFromUrl('/preview/%')).toBe('')
  })

  it('returns empty when the URL is absent', () => {
    expect(previewPathFromUrl(undefined)).toBe('')
  })
})
