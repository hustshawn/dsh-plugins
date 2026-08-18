/**
 * Shared vitest preset for the plugins in this repository.
 *
 * Every plugin that reads session events imports
 * `@deepseek-ai/dsh-client-runtime/client`, which ships a
 * `window.__ModuleLoader__` browser artifact the Web shell resolves through its
 * frozen module table. Node cannot import it, so a suite must alias it to a
 * stub — the test-side equivalent of that table entry.
 * @module
 */
import type { UserConfig } from 'vitest/config'

/** The client-runtime specifier whose real package is unimportable in Node. */
export const CLIENT_RUNTIME_SPECIFIER = '@deepseek-ai/dsh-client-runtime/client'

/** Per-package test wiring. */
export interface PluginTestOptions {
  /**
   * Absolute path to this package's client-runtime stub. Kept per package
   * rather than shared, so a suite can decide what its stub returns.
   */
  readonly clientRuntimeStub?: string
  /** Sources excluded from coverage, relative to the package root. */
  readonly coverageExclude?: readonly string[]
}

/**
 * Build the vitest config for one plugin package.
 * @param options - Stub location and coverage exclusions.
 * @returns The vitest config for this package.
 */
export function pluginTest(options: PluginTestOptions = {}): UserConfig {
  return {
    ...options.clientRuntimeStub === undefined ? {} : {
      resolve: { alias: { [CLIENT_RUNTIME_SPECIFIER]: options.clientRuntimeStub } },
    },
    test: {
      // Node throughout: the tested modules are deliberately free of React and
      // of the DOM, so no jsdom is needed.
      environment: 'node',
      include: ['tests/**/*.spec.ts'],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        exclude: [...options.coverageExclude ?? []],
      },
    },
  }
}
