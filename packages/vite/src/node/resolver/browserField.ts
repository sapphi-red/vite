// https://github.com/defunctzombie/package-browser-field-spec
// https://github.com/evanw/package-json-browser-tests

import path from 'node:path'
import { browserExternalId } from '../plugins/resolve'
import { isObject, normalizePath } from '../utils'
import type { ResolveResult } from './customUtils'
import { readPackageJson } from './customUtils'
import { lookupPackageScope } from './esmSpec'
import type { RequiredInternalResolveOptions } from './options'
import { packageResolveExtended, pathResolve } from './resolvers'

export async function tryRelativeBrowserFieldMapping(
  absolutePath: string,
  opts: RequiredInternalResolveOptions
): Promise<ResolveResult> {
  if (!opts.mainFields.includes('browser')) return null

  const packagePath = await lookupPackageScope(absolutePath)
  if (!packagePath) return null

  const pkgJson = await readPackageJson(packagePath)
  if (!pkgJson?.browser || !isObject(pkgJson.browser)) return null

  const relativePath = getRelativePath(packagePath, absolutePath)
  if (relativePath === '.') {
    // no bundler supports remapping "."
    return null
  }

  const remapped = mapWithBrowserField(
    pkgJson.browser,
    relativePath,
    opts.extensions
  )
  return await resolveMappedPath(remapped, packagePath, opts)
}

export async function tryBareBrowserFieldMapping(
  id: string,
  importer: string,
  opts: RequiredInternalResolveOptions
): Promise<ResolveResult> {
  if (!opts.mainFields.includes('browser')) return null

  const packagePath = await lookupPackageScope(importer)
  if (!packagePath) return null

  const pkgJson = await readPackageJson(packagePath)
  if (!pkgJson?.browser || !isObject(pkgJson.browser)) return null

  const remapped = mapWithBrowserField(pkgJson.browser, id, opts.extensions)
  if (remapped || remapped === false) {
    return await resolveMappedPath(remapped, packagePath, opts)
  }

  // browser field maps "require('pkg')" to './pkg' entry
  const relativePath = `${getRelativePath(packagePath, importer)}/${id}`
  const remappedFallback = mapWithBrowserField(
    pkgJson.browser,
    relativePath,
    [] // doesn't match with './pkg.js' entry
  )
  return await resolveMappedPath(remappedFallback, packagePath, opts)
}

export async function tryMainFieldBrowserFieldMapping(
  mainField: string,
  browserField: string | Record<string, string | false> | undefined,
  opts: RequiredInternalResolveOptions
): Promise<string | false | null> {
  if (!browserField || !isObject(browserField)) return null
  if (!opts.mainFields.includes('browser')) return null

  const normalizedMainField = !mainField.startsWith('./')
    ? `./${mainField}`
    : mainField

  return mapWithBrowserField(browserField, normalizedMainField, opts.extensions)
}

function getRelativePath(from: string, to: string): string {
  const relative = normalizePath(path.relative(from, to))
  if (relative === '.' || relative === '..' || relative.startsWith('../')) {
    return relative
  }
  return `./${relative}`
}

async function resolveMappedPath(
  id: string | false | null,
  importerDir: string,
  opts: RequiredInternalResolveOptions
): Promise<ResolveResult> {
  if (id === false) {
    return { id: browserExternalId }
  }
  if (!id) {
    return null
  }

  const importer = importerDir + '/dummy'
  if (id.startsWith('./')) {
    return await pathResolve(id, importer, opts, false)
  }
  return await packageResolveExtended(id, importer, opts)
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
  map: Record<string, string | false>,
  relativePathInPkgDir: string,
  extensions: string[]
): string | false | null {
  const remapped = internalMapWithBrowserField(
    map,
    relativePathInPkgDir,
    extensions
  )
  if (remapped || remapped === false) {
    return remapped
  }

  const relativeIndexPathInPkgDir = relativePathInPkgDir + '/index'
  return internalMapWithBrowserField(map, relativeIndexPathInPkgDir, extensions)
}

function internalMapWithBrowserField(
  map: Record<string, string | false>,
  relativePathInPkgDir: string,
  extensions: string[]
): string | false | null {
  const remapped = map[relativePathInPkgDir]
  if (remapped !== undefined) {
    return remapped
  }

  for (const ext of extensions) {
    const remapped = map[`${relativePathInPkgDir}.${ext}`]
    if (remapped !== undefined) {
      return remapped
    }
  }
  return null
}

export function resolveSimpleBrowserField(
  browserField: string | Record<string, string | false>
): string | null {
  if (typeof browserField === 'string') {
    return browserField
  }
  // don't do anything if browserField is object
  // because no bundler supports remapping "."
  return null
}
