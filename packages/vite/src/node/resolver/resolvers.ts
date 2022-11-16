import url from 'node:url'
import path from 'node:path'
import {
  isBuiltin,
  isDataUrl,
  isExternalUrl,
  isWindows,
  normalizePath
} from '../utils'
import type { RequiredInternalResolveOptions } from './options'
import {
  loadAsFileOrDirectory,
  loadNodeModules,
  resolveNestedSelectedPackages
} from './cjsSpec'
import type { NonErrorResolveResult, ResolveResult } from './customUtils'
import { interpretPackageName, tryRealPath } from './customUtils'
import { esmFileFormat, packageSelfResolve } from './esmSpec'
import { tryBareBrowserFieldMapping } from './browserField'
import { tryAppendSideEffects } from './sideEffectsField'

export async function resolveAbsolute(
  id: string,
  importer: string,
  opts: RequiredInternalResolveOptions
): Promise<ResolveResult> {
  // 1.
  if (id.startsWith('node:')) {
    return await resolveNodeBuiltin(id, importer, opts)
  }

  // 2.
  if (id.startsWith('file:')) {
    return { id: url.fileURLToPath(id) }
  }

  // 3.
  // data uri: pass through (this only happens during build and will be
  // handled by dedicated plugin)
  if (isDataUrl(id)) {
    return null
  }
  // external
  if (isExternalUrl(id)) {
    return { id, external: true }
  }

  // 4.
  if ((!isWindows && id.startsWith('/')) || (isWindows && /^\w:/.test(id))) {
    return { id }
  }
  return { error: `File not found: ${JSON.stringify(id)}` }
}

export async function pathResolve(
  id: string,
  importer: string,
  opts: RequiredInternalResolveOptions,
  enableBrowserFieldMapping: boolean
): Promise<ResolveResult> {
  const absolute = normalizePath(path.resolve(path.dirname(importer), id))
  // 3.a. and 3.b.
  return await loadAsFileOrDirectory(
    absolute,
    opts,
    true,
    enableBrowserFieldMapping
  )
}

export async function packageResolveExtended(
  id: string,
  importer: string,
  opts: RequiredInternalResolveOptions
): Promise<ResolveResult> {
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

  // RESOLVE 5.
  const resolved = await packageResolve(id, importer, opts, external)
  if (resolved) {
    const resolvedWithSideEffects = await tryAppendSideEffects(resolved)
    const resolvedRealPath = await tryRealPath(
      resolvedWithSideEffects,
      opts.preserveSymlinks
    )

    if (opts.postPackageResolve && !('error' in resolvedRealPath)) {
      // should be ok since resolvedRealPath.error doesn't exist
      const originalResolvedId = (resolved as NonErrorResolveResult).id

      const isResolvedFileFormat = await esmFileFormat(
        originalResolvedId /* use non-realpath for cache hit */
      )
      const newId = await opts.postPackageResolve(
        id,
        resolvedRealPath,
        isResolvedFileFormat === 'commonjs'
      )
      if (resolvedRealPath.id !== newId) {
        resolvedRealPath.id = newId
      }
    }
    return resolvedRealPath
  }

  return null
}

export async function packageResolve(
  id: string,
  importer: string,
  opts: RequiredInternalResolveOptions,
  external: boolean
): Promise<ResolveResult> {
  // 2.
  if (id === '') return null
  // 3.
  if (opts.nodeBuiltin === 'only-builtin' && isBuiltinModule(id)) {
    return { id, external: true }
  }

  // 4. - 6.
  const [pkgName, subpath] = interpretPackageName(id)
  if (!pkgName) return null

  // 7. - 8.
  const selfPath = await packageSelfResolve(pkgName, subpath, importer, opts)
  if (selfPath) {
    return selfPath
  }

  const bareBrowserFieldMapped = await tryBareBrowserFieldMapping(
    id,
    importer,
    opts
  )
  if (bareBrowserFieldMapped) {
    return bareBrowserFieldMapped
  }

  // 9. - 10.
  const resolved = await loadNodeModules(
    pkgName,
    subpath,
    importer,
    opts,
    external
  )
  if (resolved) {
    return resolved
  }

  if (opts.nodeBuiltin !== 'only-builtin' && isBuiltinModule(id)) {
    return await resolveNodeBuiltin(id, importer, opts)
  }

  return null
}

async function resolveNodeBuiltin(
  id: string,
  importer: string,
  opts: RequiredInternalResolveOptions
): Promise<ResolveResult> {
  if (typeof opts.nodeBuiltin === 'function') {
    return await opts.nodeBuiltin(id, importer)
  }
  return { id, external: true }
}

function isBuiltinModule(id: string): boolean {
  return id.startsWith('node:') || isBuiltin(id)
}
