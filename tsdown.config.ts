/**
 * Standalone build config for this DSH client plugin.
 *
 * Two artifacts from one package:
 *
 * - `lib/index.js` — the Node (Host) half, imported by the Cordis Loader.
 * - `lib/client.js` — the browser half, fetched by the Web shell OUTSIDE any
 *   module graph. It must therefore be a self-registering closure factory:
 *   `window.__ModuleLoader__.load({ id, factory })`, where `factory(require)`
 *   resolves shared modules through the shell's frozen module table.
 *
 * The banner/footer/intro below produce exactly that wrapper. `id` must equal
 * this package's name, because the shell keys the table entry by it.
 */
import type { UserConfig } from 'tsdown'

/** Package name; also the module-table id the shell registers this bundle under. */
const ID = '@hustshawn/dsh-artifact-preview'

/**
 * Specifiers the Web shell shares through its module table. A browser bundle
 * must NOT inline these: a second copy of React or of a service module would
 * be a distinct runtime identity from the shell's, so hooks and DI break.
 *
 * Mirrors the harness `PLATFORM_MODULES` seed plus the documented
 * `dsh-client-runtime/client` entry. Anything absent from this list is inlined,
 * because the frozen table cannot answer a require for it.
 */
const SHELL_PROVIDED: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
]

/** Node half: plain ESM the Loader imports; compiled from tsc output. */
const nodeHalf: UserConfig = {
  name: ID,
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}

/** Browser half: the ModuleLoader closure-factory bundle. */
const browserHalf: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'lib/types/client/index.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  // Types ship from tsc (lib/types); emitting dts here would wrap the
  // banner/footer into the declaration and break parsing.
  dts: false,
  // The shell fetches this bundle outside Vite's graph, so it carries its own map.
  sourcemap: true,
  clean: false,
  external: [...SHELL_PROVIDED],
  // tsdown auto-externalizes declared dependencies; for a browser bundle that
  // would emit requires the frozen table cannot answer. Invert it: keep the
  // shell-provided list external, inline everything else.
  noExternal: (id: string) => (SHELL_PROVIDED.includes(id) ? undefined : true),
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [nodeHalf, browserHalf]
