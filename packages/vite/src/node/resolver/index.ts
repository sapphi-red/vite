import path from 'node:path'
import type { ResolveIdResult } from 'rollup'
import { isDataUrl, isExternalUrl, isWindows } from '../utils'
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

type Resolver = (
  id: string,
  importer: string,
  overrideOptions?: InternalResolveOptions
) => Promise<ResolveIdResult>

export function createResolver(options: InternalResolveOptions): Resolver {
  const resolvedOptions = shallowMergeNonUndefined(
    internalResolveOptionsDefault,
    options
  )

  return async (id, importer, overrideOptions) => {
    const opts = overrideOptions
      ? shallowMergeNonUndefined(resolvedOptions, overrideOptions)
      : resolvedOptions
    const resolvedImporter = path.resolve(opts.root, importer)

    const resolved = await innerResolve(id, resolvedImporter, opts)
    if (!resolved) {
      return resolved
    }
    if ('error' in resolved) {
      throw new Error(resolved.error)
    }
    return {
      ...resolved,
      id: await resolveRealPath(resolved.id, opts.preserveSymlinks)
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
    return await pathResolve(id, importer, opts)
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

  // 5.
  const resolved = await packageResolve(id, importer, opts)
  if (resolved) {
    return await resolveAbsolute(id, opts)
  }

  return null
}
