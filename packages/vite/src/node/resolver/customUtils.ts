import path from 'node:path'
import fs from 'node:fs/promises'
import { resolve as resolveExports } from 'resolve.exports'
import { normalizePath } from '../utils'
import { browserExternalId } from '../plugins/resolve'
import { fsReadFile, fsStat } from './fsUtils'

export type NonErrorResolveResult = {
  id: string
  external?: boolean
  moduleSideEffects?: boolean | 'no-treeshake'
}

export type ResolveResult = null | NonErrorResolveResult | { error: string }

const EXPORTS_PATTERN = /^((?:@[^/\\%]+\/)?[^./\\%][^/\\%]*)(\/.*)?$/
export function interpretPackageName(
  id: string
): [name: string | undefined, subpath: string] {
  const m = id.match(EXPORTS_PATTERN)
  if (!m || !m[1]) return [undefined, '']

  return [m[1], m[2] ?? '']
}

export async function resolvePackageExports(
  pkgDir: string,
  pkgJson: Record<string, any>,
  subpath: string,
  conditions: string[],
  preserveSymlinks: boolean
): Promise<ResolveResult> {
  try {
    const relativeResolved = resolveExports(pkgJson, `.${subpath}`, {
      unsafe: true,
      conditions
    })
    if (relativeResolved) {
      const resolved = normalizePath(path.resolve(pkgDir, relativeResolved))
      const stat = await fsStat(resolved)
      if (stat) {
        return { id: resolved }
      }
      return {
        error: `exports field of ${JSON.stringify(
          pkgDir
        )} resolves ${JSON.stringify(`.${subpath}`)} to ${JSON.stringify(
          resolved
        )} but that file doesn't exist.`
      }
    }
  } catch (e) {
    return {
      error: `${JSON.stringify(
        `.${subpath}`
      )} is not exported from ${JSON.stringify(pkgDir)}. (${e})`
    }
  }
  return {
    error: `${JSON.stringify(
      `.${subpath}`
    )} is not exported from ${JSON.stringify(pkgDir)}.`
  }
}

export async function readPackageJson(
  dir: string
): Promise<Record<string, any> | null> {
  const content = await fsReadFile(path.join(dir, 'package.json'))
  if (!content) return null

  let parsed: any
  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }

  if (typeof parsed !== 'object') {
    return null
  }

  return parsed
}

// TODO: mix sync/async for perf?
export async function tryRealPath<T extends ResolveResult>(
  resolved: T,
  preserveSymlinks: boolean
): Promise<T> {
  if (!resolved || 'error' in resolved || resolved.external) return resolved
  if (resolved.id.startsWith(browserExternalId)) return resolved

  resolved.id = await resolveRealPath(resolved.id, preserveSymlinks)
  return resolved
}

// TODO: mix sync/async for perf?
export async function resolveRealPath(
  resolved: string,
  preserveSymlinks: boolean
): Promise<string> {
  if (preserveSymlinks) return resolved
  return normalizePath(await fs.realpath(resolved))
}

export function resolveExternalized(
  result: Exclude<ResolveResult, null>,
  specifierToBeUsed?: string
): ResolveResult {
  if ('error' in result) return result

  // don't externalize non-js imports
  if (!/^\.[mc]?js$/.test(path.extname(result.id))) {
    return result
  }

  if (specifierToBeUsed) {
    result.id = specifierToBeUsed
  }
  result.external = true

  return result
}
