/**
 * The `/preview` route as a client observes it: status codes, which body comes
 * back, and the refusals. Runs against a real temporary workspace rather than a
 * mocked filesystem, because "does this file resolve and read" is the behaviour
 * under test.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { apply, createPreviewHandler, inject, name, ROUTE_PATH } from '../src/index.ts'

/** Captured response: the status and body a handler produced. */
interface Captured {
  status: number
  body: string
  headers: Record<string, unknown>
}

let root: string
let handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>

/** Drive the handler with one request and capture what it answered. */
async function request(path: string, method = 'GET'): Promise<Captured> {
  const captured: Captured = { status: 0, body: '', headers: {} }
  const res = {
    writeHead(status: number, headers?: Record<string, unknown>) {
      captured.status = status
      if (headers !== undefined) captured.headers = headers
      return this
    },
    end(body?: string) {
      captured.body = body ?? ''
      return this
    },
  } as unknown as ServerResponse
  const req = { method, url: `${ROUTE_PATH}/${encodeURIComponent(path)}` } as IncomingMessage
  await handler(req, res)
  return captured
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'artifact-preview-'))
  await writeFile(join(root, 'page.html'), '<!DOCTYPE html><body><h1>raw</h1></body>')
  await writeFile(join(root, 'doc.md'), '# Heading\n\ntext')
  await writeFile(join(root, 'notes.markdown'), '## Second')
  await writeFile(join(root, 'data.json'), '{"a":1}')
  await mkdir(join(root, 'nested'), { recursive: true })
  await writeFile(join(root, 'nested', 'deep.md'), '# Deep')
  handler = createPreviewHandler(root)
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('plugin metadata', () => {
  it('declares a stable name and its required service', () => {
    expect(name).toBe('artifact-preview')
    expect(inject).toEqual(['webServer'])
  })

  it('registers exactly one prefix route on the webserver', () => {
    const routes: Array<{ kind: string, path: string }> = []
    const ctx = {
      webServer: {
        register: (route: { kind: string, path: string }) => {
          routes.push({ kind: route.kind, path: route.path })
          return () => {}
        },
      },
      effect: (fn: () => unknown) => { fn() },
    }
    apply(ctx as never)
    expect(routes).toEqual([{ kind: 'prefix', path: '/preview' }])
  })
})

describe('serving markdown', () => {
  it('renders a .md file as a full styled page', async () => {
    const res = await request('doc.md')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(res.body.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(res.body).toContain('<h1>Heading</h1>')
    expect(res.body).toContain('<style>')
  })

  it('renders a .markdown file the same way', async () => {
    const res = await request('notes.markdown')
    expect(res.status).toBe(200)
    expect(res.body).toContain('<h2>Second</h2>')
  })

  it('renders markdown reached through a subdirectory', async () => {
    const res = await request('nested/deep.md')
    expect(res.status).toBe(200)
    expect(res.body).toContain('<h1>Deep</h1>')
  })
})

describe('serving other files', () => {
  it('passes an .html file through untouched', async () => {
    const res = await request('page.html')
    expect(res.status).toBe(200)
    expect(res.body).toBe('<!DOCTYPE html><body><h1>raw</h1></body>')
    // No markdown wrapper: the file is already a document.
    expect(res.body).not.toContain('<style>')
  })

  it('passes a non-previewable extension through rather than converting it', async () => {
    // The route serves what it is asked for; the BUTTON is what limits kinds.
    const res = await request('data.json')
    expect(res.status).toBe(200)
    expect(res.body).toBe('{"a":1}')
  })
})

describe('path handling', () => {
  it('accepts an absolute path, which is what tools report', async () => {
    const res = await request(join(root, 'doc.md'))
    expect(res.status).toBe(200)
    expect(res.body).toContain('<h1>Heading</h1>')
  })

  it('accepts a workspace-relative path', async () => {
    const res = await request('doc.md')
    expect(res.status).toBe(200)
  })

  it('answers a path with spaces once decoded', async () => {
    await writeFile(join(root, 'my file.md'), '# Spaced')
    const res = await request('my file.md')
    expect(res.status).toBe(200)
    expect(res.body).toContain('<h1>Spaced</h1>')
  })
})

describe('refusals', () => {
  it('answers 404 for a file that does not exist', async () => {
    const res = await request('absent.md')
    expect(res.status).toBe(404)
  })

  it('answers 404 for a directory, which names no previewable file', async () => {
    const res = await request('nested')
    expect(res.status).toBe(404)
  })

  it('answers 400 when no path is given', async () => {
    const res = await request('')
    expect(res.status).toBe(400)
  })

  it.each([
    ['relative traversal', '../../etc/passwd'],
    ['absolute path outside the root', '/etc/passwd'],
  ])('answers 403 for %s', async (_name, path) => {
    const res = await request(path)
    expect(res.status).toBe(403)
  })

  it('does not leak file contents in a refusal body', async () => {
    const res = await request('/etc/passwd')
    expect(res.status).toBe(403)
    expect(res.body).not.toContain('root:')
  })

  it.each(['POST', 'PUT', 'DELETE', 'PATCH'])('answers 405 for %s', async (method) => {
    const res = await request('doc.md', method)
    expect(res.status).toBe(405)
  })

  it('accepts HEAD alongside GET, since both are reads', async () => {
    const res = await request('doc.md', 'HEAD')
    expect(res.status).toBe(200)
  })
})
