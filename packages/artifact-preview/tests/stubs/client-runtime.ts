/**
 * Stand-in for `@deepseek-ai/dsh-client-runtime/client` in tests.
 *
 * The real package ships a `window.__ModuleLoader__.load(...)` browser artifact:
 * it is resolved at runtime through the Web shell's frozen module table, not
 * imported, so it cannot be loaded in Node. Aliasing it here (see
 * `vitest.config.ts`) is the test-side equivalent of that table entry.
 *
 * Only the values this plugin actually imports need to exist. Types come from
 * the real package during typecheck, so this file carries no type declarations.
 * @module
 */

/**
 * Whether an event belongs to the appended surface.
 *
 * The real implementation excludes events that a compaction replaced. Tests
 * exercise ordinary appended events, so the stub accepts everything; a suite
 * that needs the exclusion drives `match` with the flag itself.
 * @returns Always true.
 */
export function isAppendSurfaceEvent(): boolean {
  return true
}
