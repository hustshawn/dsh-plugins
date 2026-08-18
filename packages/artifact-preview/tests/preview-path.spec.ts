/**
 * Preview path resolution: which requests name a readable file, and which are
 * refused. Containment here is a security property, so the escape attempts are
 * as much the subject as the happy paths.
 */
import { describe, expect, it } from 'vitest'
import { join, sep } from 'node:path'
import { previewRequestFromUrl, resolvePreviewTarget } from '../src/preview-path.ts'

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

describe('previewRequestFromUrl', () => {
  it('splits the session id from the file path', () => {
    expect(previewRequestFromUrl('/preview/session-1/docs/a.md'))
      .toEqual({ sessionId: 'session-1', path: 'docs/a.md' })
  })

  it('decodes both segments', () => {
    const url = `/preview/${encodeURIComponent('session-1')}/${encodeURIComponent('/abs/my file.md')}`
    expect(previewRequestFromUrl(url)).toEqual({ sessionId: 'session-1', path: '/abs/my file.md' })
  })

  it('keeps an unencoded absolute path whole, including its slashes', () => {
    // Only the FIRST slash separates the id, so later ones stay in the path.
    expect(previewRequestFromUrl('/preview/session-1//abs/dir/a.md'))
      .toEqual({ sessionId: 'session-1', path: '/abs/dir/a.md' })
  })

  it('ignores a query string', () => {
    expect(previewRequestFromUrl('/preview/session-1/a.md?t=123'))
      .toEqual({ sessionId: 'session-1', path: 'a.md' })
  })

  it.each([
    ['a session id with no path segment', '/preview/session-1'],
    ['the bare prefix', '/preview/'],
    ['a URL outside this route', '/other/session-1/a.md'],
    ['an absent URL', undefined],
  ])('returns nothing for %s', (_name, url) => {
    expect(previewRequestFromUrl(url)).toEqual({ sessionId: '', path: '' })
  })

  it('reports an empty path when the id is present but the path is not', () => {
    expect(previewRequestFromUrl('/preview/session-1/')).toEqual({ sessionId: 'session-1', path: '' })
  })

  it('returns nothing for a malformed escape instead of throwing', () => {
    // A lone '%' makes decodeURIComponent throw; the route must still answer.
    expect(() => previewRequestFromUrl('/preview/session-1/%')).not.toThrow()
    expect(previewRequestFromUrl('/preview/session-1/%')).toEqual({ sessionId: '', path: '' })
  })
})
