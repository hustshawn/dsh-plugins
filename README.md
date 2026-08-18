# dsh-artifact-preview

Claude-style **Artifacts** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): when the agent writes an `.html` or `.md` file, an **Open Preview** button appears in the conversation and opens the file in a resizable side panel.

- **HTML** renders live in a sandboxed iframe (scripts run, so interactive pages work)
- **Markdown** renders in a plain GitHub-like style on white
- The panel is **resizable by dragging its left edge**; the conversation column absorbs the change while the sidebar keeps its own width
- Width is remembered across sessions; double-click the edge to reset

This is a plain DSH plugin. It adds no model-facing tool, changes no agent behaviour, and touches nothing in the harness itself — composing it out removes the feature completely.

## Requirements

- DeepSeek Harness `>= 0.1.0-rc.7` running its **Web** surface (`dsh web`)
- Node `^22.19 || >=24`

## Install

The harness composes plugins from a `cordis.yml`/`cordis.patch.yml` layer, so
installation is two steps: make the package resolvable **from the profile
directory**, then add one row.

`$DSH_HOME` defaults to `~/.dsh`; the Web profile lives at
`$DSH_HOME/profiles/web/`.

### 1. Install into the profile

The profile directory has its own `package.json`. Declaring the plugin there is
what makes a bare package name resolvable — the shared
`$DSH_HOME/profiles/node_modules` fallback mirrors only the *harness's own*
dependency graph, so a third-party plugin is not reachable through it.

```sh
cd "${DSH_HOME:-$HOME/.dsh}/profiles/web"
npm install @hustshawn/dsh-artifact-preview
```

To run from a source checkout instead, install it by path:

```sh
git clone https://github.com/hustshawn/dsh-artifact-preview.git
cd dsh-artifact-preview && npm install && npm run build

cd "${DSH_HOME:-$HOME/.dsh}/profiles/web"
npm install "file:/absolute/path/to/dsh-artifact-preview"
```

### 2. Add one row to the profile patch

Edit `$DSH_HOME/profiles/web/cordis.patch.yml`. A profile patch is a top-level
YAML array applied after every bundle layer:

```yaml
- insert:
    - id: ui-artifact-preview
      name: '@hustshawn/dsh-artifact-preview'
```

### 3. Restart

```sh
dsh web
```

Restarting is required: the Cordis Loader reads the composition at startup, and
client-plugin bundles are registered into the module table at that point.

To turn the feature off, delete that row (or set `disabled: true` on it) and restart.

## Verifying it loaded

With the server on `127.0.0.1:7788`:

```sh
# the browser bundle is served (200)
curl -s -o /dev/null -w '%{http_code}\n' \
  'http://127.0.0.1:7788/plugins/@hustshawn/dsh-artifact-preview/client.js'

# the preview route answers, and a missing file is a real 404 (not the SPA shell)
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:7788/preview/__nope__.md'
```

A `404` on the second call is the useful signal: the SPA fallback would answer
`200` with the app shell, so `404` proves this plugin's route is the one replying.

## How it works

Two halves in one package.

**Host half** (`src/index.ts`) registers a `/preview` prefix route on
`ctx.webServer`. `.md` and `.markdown` are converted to HTML and wrapped in a
GitHub-like stylesheet; every other extension is served verbatim. Both absolute
and workspace-relative request paths are accepted, and a path that resolves
outside the workspace root is rejected with `403`.

**Browser half** (`src/client/index.ts`) contributes three things:

| Contribution | Target | Role |
|---|---|---|
| `ConversationNodeDefinition` | `ctx.conversationEvents` | Correlates a `tool/call` (which carries `file_path`) with its `tool/result` (which settles success) by `callId` |
| Keyed Chat renderer | `conversation.chat.node` | The **Open Preview** button row |
| Overlay entry | `shell.overlay` | The side panel, its iframe, and the resize grip |

The button appears only after the write **settles successfully**: a pending or
failed write has no file worth opening.

### Why the path comes from `tool/call`

A tool's render intent (`callView`, with its `diffs`/`locations`) is computed by
the Host per frame and is deliberately **not** part of the session log, so a
Definition that reads it matches nothing on replay. The durable facts are:

```js
tool/call.data   = { turn, step, callId, name, arguments }  // file_path lives in arguments
tool/result.data = { turn, step, message }                  // message.source.callId, content[0].isError
```

## Security

The iframe runs with `sandbox="allow-scripts allow-forms allow-popups"` and
**without** `allow-same-origin`, so previewed content is in an opaque origin: it
cannot read the harness page's DOM, storage, or cookies.

The `/preview` route serves files under the workspace root only. It follows the
Host process's own filesystem authority and applies no further access control, so
treat it as equivalent to what the agent can already read.

## Development

```sh
npm install
npm run typecheck    # tsc --noEmit
npm test             # vitest run
npm run build        # tsc + tsdown -> lib/index.js, lib/client.js
```

### Layout

| Path | Role |
|---|---|
| `src/index.ts` | Host half: the `/preview` route |
| `src/markdown.ts` | Markdown to HTML, and the page shell |
| `src/preview-path.ts` | Request-path resolution and containment |
| `src/client/index.ts` | Browser half: slot registrations, button, panel |
| `src/client/artifact-definition.ts` | The Conversation Node Definition |
| `src/client/artifact-events.ts` | Reading writes out of session events |
| `src/client/panel-width.ts` | Panel width bounds, default, drag arithmetic |

### Tests

`npm test` runs 215 tests over the logic modules; `npm run test:coverage` reports
100% of statements, functions, and lines, with three documented unreachable
branches. The suites are organised by the contract each one pins:

| Suite | Covers |
|---|---|
| `markdown.spec.ts` | Conversion, and that fenced code is never reinterpreted |
| `preview-path.spec.ts` | Path resolution, and every traversal attempt |
| `preview-route.spec.ts` | Route responses against a real temporary workspace |
| `artifact-events.spec.ts` | Event field reading, on real session-log payloads |
| `artifact-definition.spec.ts` | `callId` correlation and settled/failed visibility |
| `panel-width.spec.ts` | Clamping, drag direction, and persistence |
| `plugin-registration.spec.ts` | What `apply()` registers, under the slot rules |

Every past defect in this plugin has a test that fails without its fix, verified
by re-introducing each one and confirming the suite reds: a `shell.overlay`
registration missing its `id` (which failed the whole client tree at boot), an
absolute path concatenated onto the workspace root, reading the write path from
the unlogged `callView`, inline rules leaking into fenced code, an inverted drag
direction, a compounding drag base, a missing `isError` read as failure, and
removed traversal containment.

The browser bundle is not an ordinary module: the Web shell fetches it outside
any module graph, so it must self-register as
`window.__ModuleLoader__.load({ id, factory })` and resolve shared modules
through the shell's frozen module table. `tsdown.config.ts` produces that
wrapper and keeps the shell-provided specifiers (React, cordis, the client
runtime) external — inlining React would give the plugin a second React identity
and break hooks. Tests reach the client runtime through an alias in
`vitest.config.ts`, which is the test-side equivalent of that table entry.

`shell.overlay` is declared by `@deepseek-ai/dsh-client-ui-layout`, which is not
published to npm, so its `SlotMap` entry is restated locally in
`src/client/index.ts` via declaration merging. The runtime spec always comes from
the declaring plugin; the local declaration only makes the key type-visible here.

## Known limitations

- **Restart required to install or remove.** The Web profile ships with the
  shared HMR row disabled, so there is no hot path for adding a plugin row.
- **Only `.html`, `.htm`, `.md`, `.markdown`.** Other artifact kinds (SVG,
  Mermaid, JSON) are not recognised.
- **Markdown support is a pragmatic subset.** Headings, emphasis, lists, links,
  images, blockquotes, fenced code, simple tables, task-list markers and rules
  are handled by a small regex converter with no dependencies. Nested lists,
  footnotes, and reference links are not. Code blocks are escaped but not
  syntax-highlighted.
- **Markdown is rendered, not sanitized.** Raw HTML in a `.md` file reaches the
  iframe as written. The sandbox contains it, but do not treat the renderer as a
  sanitizer for untrusted documents.
- **No live reload.** The panel shows the file as of the last load; use the
  refresh button after an edit.
- **Preview is not per-session.** The route resolves paths against the Host
  process working directory, which is the right root for a single-workspace
  `dsh web` and not for serving several workspaces from one Host.

## License

MIT — see [LICENSE](LICENSE).
