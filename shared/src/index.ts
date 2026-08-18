/**
 * Shared build and test plumbing for the plugins in this repository.
 * @module
 */
export { pluginBuild, SHELL_PROVIDED, type PluginBuildOptions } from './plugin-build.ts'
export { pluginTest, CLIENT_RUNTIME_SPECIFIER } from './plugin-test.ts'
