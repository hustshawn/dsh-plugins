# dsh-plugins

A collection of plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

DSH composes everything as a plugin, and a plugin can add UI, tools, or host
capabilities without a fork: it contributes through documented extension points,
and a composition that omits its row loses that feature and nothing else. These
are plugins built that way, kept together so the build and test plumbing they all
need exists once.

## Plugins

| Plugin | Package | What it adds |
|---|---|---|
| [artifact-preview](packages/artifact-preview) | `@hustshawn/dsh-artifact-preview` | Claude-style Artifacts: preview HTML and Markdown files the agent writes, in a resizable side panel |

Each plugin's own README owns its install steps, behaviour, and limitations.

## Repository layout

```
packages/<plugin>/     One installable plugin, published on its own
shared/                Build and test presets every plugin uses
```

`shared/` is private and never published. It exists because two facts about DSH
plugins are easy to get wrong and expensive to rediscover:

- **The browser half is not an ordinary module.** The Web shell fetches it
  outside any module graph, so it must self-register as
  `window.__ModuleLoader__.load({ id, factory })` and resolve shared modules
  through the shell's frozen module table. `shared/src/plugin-build.ts` produces
  that wrapper.
- **Shell-provided modules must stay external.** Inlining React gives the plugin
  a second React identity and breaks hooks; inlining a service module yields a
  different DI entity than the one the shell registered. The same file owns that
  list.

A plugin's own `tsdown.config.ts` is then a few lines naming its entries.

## Development

Requires Node `^22.19 || >=24` and pnpm.

```sh
pnpm install
pnpm run typecheck    # every package
pnpm run test         # every package
pnpm run build        # every package
```

To work on one plugin:

```sh
pnpm --filter @hustshawn/dsh-artifact-preview run test
pnpm --filter @hustshawn/dsh-artifact-preview run build
```

### Adding a plugin

1. `packages/<name>/` with a `package.json` carrying a `dsh` manifest field
   (`dsh.client` for a browser half), and `@hustshawn/dsh-plugin-shared` as a
   dev dependency.
2. `tsconfig.json` extending
   `@hustshawn/dsh-plugin-shared/tsconfig.plugin.json`.
3. `tsdown.config.ts` calling `pluginBuild({ id, nodeEntries?, clientEntry? })`,
   where `id` is the package name — the shell keys its module-table entry by it.
4. `vitest.config.ts` calling `pluginTest(...)`, passing a client-runtime stub
   when the plugin reads session events.
5. A README covering install, behaviour, and limitations, and an entry in the
   table above.

## License

MIT — see [LICENSE](LICENSE).
