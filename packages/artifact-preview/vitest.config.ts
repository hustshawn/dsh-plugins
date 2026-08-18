/**
 * Test config: the repository's shared plugin preset, plus this package's own
 * client-runtime stub.
 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { pluginTest } from '@hustshawn/dsh-plugin-shared'

export default defineConfig(pluginTest({
  clientRuntimeStub: fileURLToPath(new URL('./tests/stubs/client-runtime.ts', import.meta.url)),
  // The plugin entry is composition (slot registration and React element
  // trees); its contract is covered by the registration suite rather than by
  // rendering it.
  coverageExclude: ['src/client/index.ts'],
}))
