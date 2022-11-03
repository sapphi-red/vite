export type InternalResolveOptions = {
  root?: string
  extensions?: string[]
  conditions?: string[]
  preserveSymlinks?: boolean
  /**
   * When a package name is same with core module,
   * Node.js always resolves to the core module instead of that package.
   * When this is true, it allows to resolve to that package.
   */
  allowCoreModuleOverride?: boolean
}
export type RequiredInternalResolveOptions = Required<InternalResolveOptions>

export const internalResolveOptionsDefault: RequiredInternalResolveOptions = {
  root: process.cwd(),
  extensions: ['js', 'json', 'node'],
  conditions: ['node', 'import'],
  preserveSymlinks: false,
  allowCoreModuleOverride: true
}

export function shallowMergeNonUndefined<T extends Record<string, any>>(
  original: Required<T>,
  override: T
): Required<T> {
  for (const [key, val] of Object.entries(override)) {
    if (val !== undefined) {
      // @ts-expect-error This should be ok
      original[key] = val
    }
  }
  return original
}
