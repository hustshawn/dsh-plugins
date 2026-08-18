import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // The real package ships a window.__ModuleLoader__ browser artifact the
      // Web shell resolves through its frozen module table, so Node cannot
      // import it. This stub is the test-side equivalent of that table entry.
      '@deepseek-ai/dsh-client-runtime/client': fileURLToPath(
        new URL('./tests/stubs/client-runtime.ts', import.meta.url),
      ),
    },
  },
  test: {
    // Node throughout: every tested module is deliberately free of React and of
    // the DOM, so no jsdom is needed.
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // The plugin entry is composition (slot registration and React element
      // trees); its contract is covered by the registration suite rather than
      // by rendering it.
      exclude: ['src/client/index.ts'],
    },
  },
})
