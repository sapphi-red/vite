import type { NonErrorResolveResult, ResolveResult } from './customUtils'

export type PrePackageResolveFunction = (
  id: string,
  importer: string,
  external: boolean
) => ResolveResult | Promise<ResolveResult>

export type PostPackageResolveFunction = (
  id: string,
  resolved: NonErrorResolveResult,
  isResolvedFileCJS: boolean
) => string | Promise<string>

export type NodeBuiltinType =
  | 'only-builtin'
  | 'allow-polyfill'
  | ((
      id: string,
      importer: string,
      external?: string
    ) => ResolveResult | Promise<ResolveResult>)

export type InternalResolveOptions = {
  root?: string
  mainFields?: string[]
  extensions?: string[]
  conditions?: string[]
  preserveSymlinks?: boolean
  preferRelative?: boolean
  /**
   * Whether to support nested selected package specifier (e.g. foo > bar > baz)
   */
  supportNestedSelectedPackages?: boolean
  /**
   * Decides how to treat Node.js builtin modules.
   *
   * When this is 'only-builtin', it only resolves to the builtin module.
   * When this is 'allow-polyfill', it first resolves to a package that has
   * a same name with the builtin module, then resolve to the builtin module.
   * When this is a function, it first resolves to a package that has
   * a same name with the builtin module, then use that function.
   */
  nodeBuiltin?: NodeBuiltinType
  /**
   * If this function is passed and returned a non-null value,
   * the result of this function will be used instead for bare specifiers.
   */
  prePackageResolve?: PrePackageResolveFunction | null
  /**
   * If this function is passed and returned a non-null value,
   * the result of this function will be used instead of the resolved value.
   */
  postPackageResolve?: PostPackageResolveFunction | null
  shouldExternalize?: ((id: string) => boolean | undefined) | null

  /** used for conditions */
  isRequire?: boolean
  isProduction?: boolean
}
export type RequiredInternalResolveOptions = Required<InternalResolveOptions>

export const internalResolveOptionsDefault: RequiredInternalResolveOptions = {
  root: process.cwd(),
  mainFields: ['main'],
  extensions: ['js', 'json', 'node'],
  conditions: ['node', 'import'],
  preferRelative: false,
  supportNestedSelectedPackages: false,
  preserveSymlinks: false,
  nodeBuiltin: 'only-builtin',
  prePackageResolve: null,
  postPackageResolve: null,
  shouldExternalize: null,

  isRequire: false,
  isProduction: false
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
