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
import { resolveRealPath, tryRealPath } from './customUtils'
import {
  packageResolveExtended,
  pathResolve,
  resolveAbsolute
} from './resolvers'
import { fsStat } from './fsUtils'
import { splitFileAndPostfix, tryWithAndWithoutPostfix } from './postfix'
import { tryAppendSideEffects } from './sideEffectsField'

type Resolver = (
  id: string,
  importer?: string,
  overrideOptions?: InternalResolveOptions
) => Promise<ResolveIdResult>

// TODO: TypeScript
// TODO: debug
// TODO: optional deps

// NOTE: run tryAppendSideEffects and tryRealPath/resolveRealPath each path on this file

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
    const resolvedImporter = await resolveImporter(importer, opts.root)

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

async function resolveImporter(
  importer: string | undefined,
  root: string
): Promise<string> {
  if (!importer) return root

  const absoluteImporter = normalizePath(path.resolve(root, importer))

  const stat = await fsStat(absoluteImporter)
  if (stat) {
    return absoluteImporter
  }

  const { file, postfix } = splitFileAndPostfix(absoluteImporter)
  if (postfix !== '') {
    const stat = await fsStat(file)
    if (stat) {
      return file
    }
  }

  // resolve from root when importer was a virtual file
  return root
}

async function innerResolve(
  id: string,
  importer: string,
  opts: RequiredInternalResolveOptions
): Promise<ResolveResult> {
  // RESOLVE 2.
  if (id.startsWith('/') || (isWindows && /^\w:/.test(id))) {
    const resolved = await pathResolve(id, importer, opts, false)
    const resolvedWithSideEffects = await tryAppendSideEffects(resolved)
    return await tryRealPath(resolvedWithSideEffects, opts.preserveSymlinks)
  }
  if (id.startsWith('./') || id.startsWith('../')) {
    const resolved = await pathResolve(id, importer, opts, true)
    const resolvedWithSideEffects = await tryAppendSideEffects(resolved)
    return await tryRealPath(resolvedWithSideEffects, opts.preserveSymlinks)
  }

  // RESOLVE 3.
  // if (id.startsWith('#')) {
  //   const resolved = await packageImportsResolve(id, importer, opts)
  //   return await resolveAbsolute(resolved, importer, opts)
  // }

  // RESOLVE 4.
  if (/^\w+:/.test(id)) {
    if (
      id.startsWith('file:') ||
      isDataUrl(id) ||
      isExternalUrl(id) ||
      id.startsWith('node:')
    ) {
      const resolved = await resolveAbsolute(id, importer, opts)
      const resolvedWithSideEffects = await tryAppendSideEffects(resolved)
      return await tryRealPath(resolvedWithSideEffects, opts.preserveSymlinks)
    }
    return null
  }

  if (opts.preferRelative && /^\w/.test(id)) {
    const resolved = await pathResolve(id, importer, opts, true)
    if (resolved && !('error' in resolved)) {
      const resolvedWithSideEffects = await tryAppendSideEffects(resolved)
      return await tryRealPath(resolvedWithSideEffects, opts.preserveSymlinks)
    }
  }

  return await packageResolveExtended(id, importer, opts)
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
