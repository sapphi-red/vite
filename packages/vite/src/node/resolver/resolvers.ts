import url from 'node:url'
import path from 'node:path'
import {
  isBuiltin,
  isDataUrl,
  isExternalUrl,
  isWindows,
  normalizePath
} from '../utils'
import { fsStat } from './fsUtils'
import type { RequiredInternalResolveOptions } from './options'
import { loadAsFileOrDirectory, loadNodeModules } from './cjsSpec'
import type { ResolveResult } from './customUtils'
import { interpretPackageName } from './customUtils'
import { packageSelfResolve } from './esmSpec'
import {
  resolveBareBrowserFieldMapping,
  tryBrowserFieldMapping
} from './browserField'

export async function resolveAbsolute(
  id: string,
  opts: RequiredInternalResolveOptions
): Promise<ResolveResult> {
  // 1.
  if (id.startsWith('file:')) {
    const path = url.fileURLToPath(id)
    const stat = await fsStat(path)
    if (stat) {
      return { id: path }
    }
    return { error: `File not found: ${JSON.stringify(path)}` }
  }

  // 2.
  // data uri: pass through (this only happens during build and will be
  // handled by dedicated plugin)
  if (isDataUrl(id)) {
    return null
  }
  // external
  if (isExternalUrl(id)) {
    return { id, external: true }
  }

  // 3.
  if ((!isWindows && id.startsWith('/')) || (isWindows && /^\w:/.test(id))) {
    const stat = await fsStat(id)
    if (stat) {
      return { id }
    }
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
  const resolved = await loadAsFileOrDirectory(absolute, true, opts)
  if (resolved) {
    if (enableBrowserFieldMapping) {
      return await tryBrowserFieldMapping(resolved, importer, opts)
    }
    return resolved
  }
  return {
    error: `Failed to resolve: ${JSON.stringify(id)} at ${JSON.stringify(
      importer
    )} ${absolute}`
  }
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
    return await tryBrowserFieldMapping(selfPath, importer, opts)
  }

  const bareBrowserFieldMapped = await resolveBareBrowserFieldMapping(
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
    return await tryBrowserFieldMapping(resolved, importer, opts)
  }

  if (opts.nodeBuiltin !== 'only-builtin' && isBuiltinModule(id)) {
    if (typeof opts.nodeBuiltin === 'function') {
      return await opts.nodeBuiltin(id, importer)
    }
    return { id, external: true }
  }

  return null
}

function isBuiltinModule(id: string): boolean {
  return id.startsWith('node:') || isBuiltin(id)
}
