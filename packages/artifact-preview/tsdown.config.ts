/**
 * Build config: both halves through the repository's shared plugin preset,
 * which owns the ModuleLoader wrapper and the shell-provided externals.
 */
import { pluginBuild } from '@hustshawn/dsh-plugin-shared'

export default pluginBuild({
  id: '@hustshawn/dsh-artifact-preview',
  nodeEntries: ['lib/types/index.js'],
  clientEntry: 'lib/types/client/index.js',
})
