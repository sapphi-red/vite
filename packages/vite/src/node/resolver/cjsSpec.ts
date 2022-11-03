import path from 'node:path'
import { normalizePath } from '../utils'
import type { ResolveResult } from './customUtils'
import { readPackageJson, resolvePackageExports } from './customUtils'
import { fsStat } from './fsUtils'
import type { RequiredInternalResolveOptions } from './options'

export async function loadAsFile(
  p: string,
  exts: string[]
): Promise<string | null> {
  for (const ext of exts) {
    const absolute = `${p}.${ext}`
    const stat = await fsStat(absolute)
    if (stat && !stat.isDirectory()) {
      return absolute
    }
  }
  return null
}

export function loadIndex(dir: string, exts: string[]): Promise<string | null> {
  const joined = path.resolve(dir, 'index')
  return loadAsFile(joined, exts)
}

export async function loadAsDirectory(
  p: string,
  opts: RequiredInternalResolveOptions
): Promise<ResolveResult> {
  // 1.
  const pkgJsonResult = await readPackageJson(p)
  if (pkgJsonResult == null || 'error' in pkgJsonResult) return pkgJsonResult

  const pkgJson = pkgJsonResult.result
  if (pkgJson && pkgJson.main) {
    // 1.c.
    const joined = normalizePath(path.resolve(p, pkgJson.main))
    const joinedStat = await fsStat(joined)
    if (joinedStat) {
      // 1.d.
      if (joinedStat.isFile()) {
        return { id: joined }
      }
      // 1.e.
      const resolved = await loadIndex(joined, opts.extensions)
      if (resolved) {
        return { id: resolved }
      }
    }
    // 1.f. (deprecated)
    const resolved = await loadIndex(p, opts.extensions)
    if (resolved) {
      return { id: resolved }
    }
    return {
      error: `main field of ${JSON.stringify(p)} has ${JSON.stringify(
        pkgJson.main
      )} but that doesn't resolve to any file.`
    }
  }

  // 2.
  const resolved = await loadIndex(p, opts.extensions)
  if (resolved) {
    return { id: resolved }
  }
  return null
}

export async function loadNodeModules(
  pkgName: string,
  subpath: string,
  importer: string,
  opts: RequiredInternalResolveOptions
): Promise<ResolveResult> {
  const importerDir = normalizePath(path.dirname(importer))
  const dirs = nodeModulesPaths(importerDir)
  for (const dir of dirs) {
    // 2.1.
    const resolvedE = await loadPackageExports(pkgName, subpath, dir, opts)
    if (resolvedE) {
      return resolvedE
    }

    const joined = normalizePath(path.join(dir, pkgName, subpath))
    // 2.2. and 2.3.
    const resolvedF = await loadAsFileOrDirectory(joined, subpath !== '.', opts)
    if (resolvedF) {
      return resolvedF
    }
  }
  return null
}

function nodeModulesPaths(dir: string): string[] {
  let slashIndex = dir.lastIndexOf('/')
  const dirs: string[] = []
  while (slashIndex > 0) {
    const former = dir.slice(0, slashIndex)
    const latter = dir.slice(slashIndex + 1)
    if (latter === 'node_modules' || latter.startsWith('node_modules/')) {
      continue
    }
    dirs.push(normalizePath(path.resolve(former, 'node_modules')))

    slashIndex = dir.lastIndexOf('/', slashIndex - 1)
  }
  return dirs
}

async function loadPackageExports(
  pkgName: string,
  subpath: string,
  dir: string,
  opts: RequiredInternalResolveOptions
): Promise<ResolveResult> {
  const pkgDir = normalizePath(path.join(dir, pkgName))
  const pkgJsonResult = await readPackageJson(pkgDir)
  if (pkgJsonResult == null || 'error' in pkgJsonResult) return pkgJsonResult

  const pkgJson = pkgJsonResult.result
  if (!pkgJson || !pkgJson.exports) return null

  // 5.
  return await resolvePackageExports(pkgDir, pkgJson, subpath, opts.conditions)
}

/**
 * doesn't exist in CJS require spec
 */
export async function loadAsFileOrDirectory(
  dir: string,
  enableFile: boolean,
  opts: RequiredInternalResolveOptions
): Promise<ResolveResult> {
  const joinedStat = await fsStat(dir)
  if (joinedStat) {
    // loadAsFile (no extension)
    if (joinedStat.isFile()) {
      return enableFile ? { id: dir } : null
    }
    if (enableFile) {
      // loadAsFile (with extension)
      const resolved = await loadAsFile(dir, opts.extensions)
      if (resolved) {
        return { id: resolved }
      }
    }

    // loadAsDir
    const resolved = await loadAsDirectory(dir, opts)
    if (resolved) {
      return resolved
    }
  }
  return null
}
