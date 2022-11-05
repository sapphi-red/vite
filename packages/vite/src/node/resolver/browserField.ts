// https://github.com/defunctzombie/package-browser-field-spec

import path from 'node:path'
import { isObject } from '../utils'

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
