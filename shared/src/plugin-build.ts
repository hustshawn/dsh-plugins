/**
 * Shared build preset for the DSH plugins in this repository.
 *
 * A DSH plugin ships two artifacts from one package, and they are built very
 * differently:
 *
 * - **The Node (Host) half** is an ordinary ESM module the Cordis Loader
 *   imports.
 * - **The browser half** is fetched by the Web shell OUTSIDE any module graph,
 *   so it cannot be an ESM module at all. It must self-register as
 *   `window.__ModuleLoader__.load({ id, factory })` and resolve shared modules
 *   through `factory(require)` — the shell's frozen module table.
 *
 * Getting that wrapper and its externals wrong fails at runtime rather than at
 * build time, so the rules live here once instead of in each plugin's config.
 * @module
 */
import type { UserConfig } from 'tsdown'

/**
 * Specifiers the Web shell shares through its frozen module table.
 *
 * A browser bundle must NOT inline these. A second copy of React is a second
 * React identity, so hooks break; a second copy of a service module is a
 * different DI entity than the one the shell registered.
 *
 * Mirrors the harness `PLATFORM_MODULES` seed plus the documented
 * `dsh-client-runtime/client` entry. Anything absent from this list is inlined,
 * because the frozen table cannot answer a require for it.
 */
export const SHELL_PROVIDED: readonly string[] = [
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

/** Shape of the two build faces a dual-half plugin emits. */
export interface PluginBuildOptions {
  /**
   * Package name. Also the module-table id the browser bundle registers under,
   * so it MUST equal the published `name` — the shell keys the entry by it and
   * the Loader fetches `/plugins/<name>/client.js`.
   */
  readonly id: string
  /**
   * Node-half entries, as emitted by tsc into `lib/types/`. Omit for a
   * browser-only plugin.
   */
  readonly nodeEntries?: readonly string[]
  /**
   * Browser-half entry, as emitted by tsc. Omit for a host-only plugin.
   */
  readonly clientEntry?: string
}

/**
 * Build the tsdown config for one DSH plugin package.
 *
 * Both halves read tsc's `lib/types/` output rather than the sources, so type
 * declarations and runtime bundles are generated from one program.
 * @param options - Package name and which halves to emit.
 * @returns The tsdown configs for this package, in build order.
 */
export function pluginBuild(options: PluginBuildOptions): UserConfig[] {
  const configs: UserConfig[] = []
  if (options.nodeEntries !== undefined && options.nodeEntries.length > 0) {
    configs.push(nodeHalf(options.id, options.nodeEntries))
  }
  if (options.clientEntry !== undefined) {
    configs.push(browserHalf(options.id, options.clientEntry))
  }
  if (configs.length === 0) {
    throw new Error(`pluginBuild("${options.id}"): declare nodeEntries, clientEntry, or both`)
  }
  return configs
}

/** Node half: plain ESM the Cordis Loader imports. */
function nodeHalf(id: string, entries: readonly string[]): UserConfig {
  return {
    name: id,
    entry: [...entries],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    // Declarations come from tsc; emitting them here would duplicate them.
    dts: false,
    // Both halves write into lib/, so neither may clean it.
    clean: false,
  }
}

/** Browser half: the self-registering ModuleLoader closure factory. */
function browserHalf(id: string, entry: string): UserConfig {
  return {
    name: `${id}/client`,
    entry: { client: entry },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    // dts here would wrap the banner/footer into the declaration and break parsing.
    dts: false,
    // The shell fetches this bundle outside Vite's graph, so it carries its own map.
    sourcemap: true,
    clean: false,
    external: [...SHELL_PROVIDED],
    // tsdown auto-externalizes declared dependencies, which for a browser
    // bundle would emit requires the frozen table cannot answer. Invert it:
    // keep the shell-provided list external and inline everything else.
    noExternal: (specifier: string) =>
      (SHELL_PROVIDED.includes(specifier) ? undefined : true),
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}
