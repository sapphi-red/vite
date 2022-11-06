// https://github.com/defunctzombie/package-browser-field-spec

import path from 'node:path'
import { browserExternalId } from '../plugins/resolve'
import { isObject, normalizePath } from '../utils'
import { loadAsFile } from './cjsSpec'
import type { ResolveResult } from './customUtils'
import { readPackageJson } from './customUtils'
import { lookupPackageScope } from './esmSpec'
import type { RequiredInternalResolveOptions } from './options'

export async function tryBrowserFieldMapping(
  /** NOTE: should pass non-realpathed id */
  resolved: Exclude<ResolveResult, null>,
  importer: string,
  opts: RequiredInternalResolveOptions
): Promise<ResolveResult> {
  if (!opts.mainFields.includes('browser')) return resolved
  if ('error' in resolved) return resolved
  if (resolved.external) return resolved

  const packagePath = await lookupPackageScope(importer)
  if (!packagePath) return resolved

  const pkgJson = await readPackageJson(packagePath)
  if (!pkgJson?.browser) return resolved

  const subpath = normalizePath(path.relative(packagePath, resolved.id))
  const mapped = resolveBrowserField(pkgJson, subpath)
  if (mapped) {
    const mappedAbsolute = normalizePath(path.resolve(packagePath, subpath))
    const resolvedMapped = await loadAsFile(mappedAbsolute, opts.extensions)
    if (resolvedMapped) {
      resolved.id = resolvedMapped
    } else {
      return {
        error: `"browser" field of ${JSON.stringify(
          packagePath
        )} mapped ${JSON.stringify(resolved.id)} to ${JSON.stringify(
          mappedAbsolute
        )} but that doesn't resolve to any file.`
      }
    }
  } else if (mapped === false) {
    resolved.id = browserExternalId
  }
  return resolved
}

export async function resolveBareBrowserFieldMapping(
  id: string,
  importer: string,
  opts: RequiredInternalResolveOptions
): Promise<ResolveResult> {
  if (!opts.mainFields.includes('browser')) return null

  const packagePath = await lookupPackageScope(importer)
  if (!packagePath) return null

  const pkgJson = await readPackageJson(packagePath)
  if (!pkgJson?.browser) return null

  const mapped = resolveBrowserField(pkgJson, id)
  if (!mapped) return null

  const mappedAbsolute = normalizePath(path.resolve(packagePath, mapped))
  const resolvedMapped = await loadAsFile(mappedAbsolute, opts.extensions)
  if (!resolvedMapped) {
    return {
      error: `"browser" field of ${JSON.stringify(
        packagePath
      )} mapped ${JSON.stringify(id)} to ${JSON.stringify(
        mappedAbsolute
      )} but that doesn't resolve to any file.`
    }
  }

  return { id: resolvedMapped }
}

export function resolveBrowserField(
  browserField: string | Record<string, string | false>,
  subpath: string
): string | false | null {
  if (typeof browserField === 'string') {
    if (subpath === '.') {
      return browserField
    }
    return null
  }

  if (isObject(browserField)) {
    if (subpath === '.') {
      return browserField['.']
    }
    return mapWithBrowserField(subpath, browserField)
  }

  return null
}

/**
 * given a relative path in pkg dir,
 * return a relative path in pkg dir,
 * mapped with the "map" object
 *
 * - Returning `null` means there is no browser mapping for this id
 * - Returning `false` means this id is explicitly externalized for browser
 */
function mapWithBrowserField(
  relativePathInPkgDir: string,
  map: Record<string, string | false>
): string | false | null {
  const normalizedPath = path.posix.normalize(relativePathInPkgDir)

  for (const key in map) {
    const normalizedKey = path.posix.normalize(key)
    if (
      normalizedPath === normalizedKey ||
      equalWithoutSuffix(normalizedPath, normalizedKey, '.js') ||
      equalWithoutSuffix(normalizedPath, normalizedKey, '/index') ||
      equalWithoutSuffix(normalizedPath, normalizedKey, '/index.js')
    ) {
      return map[key]
    }
  }
  return null
}

function equalWithoutSuffix(path: string, key: string, suffix: string) {
  return key.endsWith(suffix) && key.slice(0, -suffix.length) === path
}
