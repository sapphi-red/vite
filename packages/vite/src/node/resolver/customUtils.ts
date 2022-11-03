import path from 'node:path'
import fs from 'node:fs/promises'
import { resolve as resolveExports } from 'resolve.exports'
import { fsReadFile, fsStat } from './fsUtils'

export type ResolveResult =
  | null
  | {
      id: string
      external?: boolean
      moduleSideEffects?: boolean | 'no-treeshake'
    }
  | { error: string }

const EXPORTS_PATTERN = /^((?:@[^/\\%]+\/)?[^./\\%][^/\\%]*)(\/.*)?$/
export function interpretPackageName(
  id: string
): [name: string | undefined, subpath: string] {
  const m = id.match(EXPORTS_PATTERN)
  if (!m || !m[1]) return [undefined, '']

  return [m[1], m[2] ?? '']
}

export async function resolvePackageExports(
  pkgPath: string,
  pkgJson: Record<string, any>,
  subpath: string,
  conditions: string[]
): Promise<ResolveResult> {
  const resolved = resolveExports(pkgJson, `.${subpath}`, {
    unsafe: true,
    conditions
  })
  if (resolved) {
    const stat = await fsStat(resolved)
    if (stat) {
      return { id: resolved }
    }
    return {
      error: `exports field of ${JSON.stringify(
        pkgPath
      )} resolves ${JSON.stringify(subpath)} to ${JSON.stringify(
        resolved
      )} but that file doesn't exist.`
    }
  }
  return {
    error: `${JSON.stringify(subpath)} is not exported from ${JSON.stringify(
      pkgPath
    )}.`
  }
}

export async function readPackageJson(
  dir: string
): Promise<{ result: Record<string, any> } | { error: string } | null> {
  const content = await fsReadFile(path.join(dir, 'package.json'))
  if (!content) return null

  let parsed: any
  try {
    parsed = JSON.parse(content)
  } catch (e) {
    return {
      error: `failed to parse package.json of ${JSON.stringify(dir)}: ${e}`
    }
  }

  if (typeof parsed !== 'object') {
    return {
      error: `failed to parse package.json of ${JSON.stringify(
        dir
      )}: was not object`
    }
  }

  return { result: parsed }
}

// TODO: mix sync/async for perf?
export async function resolveRealPath(
  resolved: string,
  preserveSymlinks: boolean
): Promise<string> {
  return preserveSymlinks ? resolved : fs.realpath(resolved)
}
