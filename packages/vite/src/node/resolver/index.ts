import path from 'node:path'
import type { ResolveIdResult } from 'rollup'
import { isDataUrl, isExternalUrl, isWindows, normalizePath } from '../utils'
import type {
  InternalResolveOptions,
  RequiredInternalResolveOptions
} from './options'
import {
  internalResolveOptionsDefault,
  shallowMergeNonUndefined
} from './options'
import type { ResolveResult } from './customUtils'
import { resolveRealPath } from './customUtils'
import { packageResolve, pathResolve, resolveAbsolute } from './resolvers'
import { fsStat } from './fsUtils'
import { tryWithAndWithoutPostfix } from './postfix'
import { resolveNestedSelectedPackages } from './cjsSpec'
import { esmFileFormat } from './esmSpec'

type Resolver = (
  id: string,
  importer?: string,
  overrideOptions?: InternalResolveOptions
) => Promise<ResolveIdResult>

// TODO: TypeScript
// TODO: browser field
// TODO: debug
// TODO: sideEffect field
// TODO: optional deps

// NOTE: run resolveRealPath when that function returns ResolveResult

export function createResolver(options: InternalResolveOptions): Resolver {
  const resolvedOptions = shallowMergeNonUndefined(
    internalResolveOptionsDefault,
    options
  )

  const resolve = tryWithAndWithoutPostfix(innerResolve)

  return async (id, importer, overrideOptions) => {
    const opts = overrideOptions
      ? shallowMergeNonUndefined(resolvedOptions, overrideOptions)
      : resolvedOptions
    const resolvedImporter = importer
      ? normalizePath(path.resolve(opts.root, importer))
      : opts.root

    opts.conditions = opts.conditions.filter((condition) => {
      switch (condition) {
        case 'import':
          return !opts.isRequire
        case 'require':
          return opts.isRequire
        case 'production':
          return opts.isProduction
        case 'development':
          return !opts.isProduction
      }
      return true
    })

    const resolved = await resolve(id, resolvedImporter, opts)
    if (resolved) {
      if ('error' in resolved) {
        throw new Error(resolved.error)
      }
      return resolved
    }
  }
}

async function innerResolve(
  id: string,
  importer: string,
  opts: RequiredInternalResolveOptions
): Promise<ResolveResult> {
  // 2.
  if (
    id.startsWith('./') ||
    id.startsWith('../') ||
    id.startsWith('/') ||
    (isWindows && /^\w:/.test(id))
  ) {
    const resolved = await pathResolve(id, importer, opts)
    // ignore not found if id starts with /
    if (id.startsWith('/')) {
      if (resolved && 'error' in resolved) {
        return null
      }
    }
    return resolved
  }

  // 3.
  // if (id.startsWith('#')) {
  //   const resolved = await packageImportsResolve(id, importer, opts)
  //   return await resolveAbsolute(resolved, opts)
  // }

  // 4.
  if (/^\w+:/.test(id)) {
    if (id.startsWith('file:') || isDataUrl(id) || isExternalUrl(id)) {
      return await resolveAbsolute(id, opts)
    }
    return null
  }

  if (opts.preferRelative && /^\w/.test(id)) {
    const result = await pathResolve(id, importer, opts)
    if (result && !('error' in result)) {
      return result
    }
  }

  const external = opts.shouldExternalize?.(id) ?? false

  if (opts.prePackageResolve) {
    const resolved = await opts.prePackageResolve(id, importer, external)
    if (resolved) {
      return resolved
    }
  }

  if (opts.supportNestedSelectedPackages && id.includes('>')) {
    ;[id, importer] = await resolveNestedSelectedPackages(id, importer)
  }

  // 5.
  const resolved = await packageResolve(id, importer, opts, external)
  if (resolved) {
    if (opts.postPackageResolve && !('error' in resolved)) {
      const isResolvedFileFormat = await esmFileFormat(resolved.id)
      const newId = await opts.postPackageResolve(
        id,
        resolved,
        isResolvedFileFormat === 'commonjs'
      )
      if (resolved.id !== newId) {
        resolved.id = newId
      }
      return resolved
    }
    return resolved
  }

  return null
}

export const resolveFile = tryWithAndWithoutPostfix(
  async (
    id: string,
    _: undefined,
    preserveSymlinks: boolean
  ): Promise<{ id: string } | { error: string }> => {
    const stat = await fsStat(id)
    if (stat) {
      return { id: await resolveRealPath(id, preserveSymlinks) }
    }
    return { error: `File not found: ${JSON.stringify(id)}` }
  }
)
