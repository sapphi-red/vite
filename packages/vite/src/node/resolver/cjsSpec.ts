import path from 'node:path'
import fs from 'node:fs/promises'
import { hasESMSyntax } from 'mlly'
import { normalizePath } from '../utils'
import type { ResolveResult } from './customUtils'
import {
  readPackageJson,
  resolveExternalized,
  resolvePackageExports
} from './customUtils'
import { fsStat } from './fsUtils'
import type { RequiredInternalResolveOptions } from './options'
import { resolveBrowserField } from './browserField'

/**
 * NOTE: this function doesn't resolve without extension
 */
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
  const joined = normalizePath(path.resolve(dir, 'index'))
  return loadAsFile(joined, exts)
}

export async function loadAsDirectory(
  dir: string,
  opts: RequiredInternalResolveOptions
): Promise<ResolveResult> {
  // 1.
  const pkgJson = await readPackageJson(dir)
  if (pkgJson != null) {
    let entryPoint: { field: string; value: string } | undefined

    if (opts.mainFields.includes('browser') && pkgJson.browser) {
      const browserEntry = resolveBrowserField(pkgJson.browser, '.')
      if (browserEntry) {
        const resolvedBrowserEntry = await loadMainField(
          dir,
          'browser',
          browserEntry,
          opts
        )
        if ('error' in resolvedBrowserEntry) {
          return resolvedBrowserEntry
        }

        const moduleEntry: string = pkgJson.module
        if (
          !opts.isRequire &&
          opts.mainFields.includes('module') &&
          moduleEntry &&
          moduleEntry !== browserEntry
        ) {
          // if both are present, we may have a problem: some package points both
          // to ESM, with "module" targeting Node.js, while some packages points
          // "module" to browser ESM and "browser" to UMD/IIFE.
          // the heuristics here is to actually read the browser entry when
          // possible and check for hints of ESM. If it is not ESM, prefer "module"
          // instead; Otherwise, assume it's ESM and use it.

          const content = await fs.readFile(resolvedBrowserEntry.id, 'utf-8')
          if (hasESMSyntax(content)) {
            // likely ESM, prefer browser
            return resolvedBrowserEntry
          } else {
            // non-ESM, UMD or IIFE or CJS(!!! e.g. firebase 7.x), prefer module
            entryPoint = { field: 'module', value: moduleEntry }
          }
        } else {
          return resolvedBrowserEntry
        }
      }
    }

    if (!entryPoint) {
      for (const field of opts.mainFields) {
        if (field === 'browser') continue // already checked above

        if (pkgJson[field]) {
          entryPoint = { field, value: pkgJson[field] }
          break
        }
      }
    }
    if (entryPoint) {
      // 1.c. - 1.e.
      return await loadMainField(dir, entryPoint.field, entryPoint.value, opts)
      // NOTE: doesn't support 1.f.
    }
  }

  // 2.
  const resolved = await loadIndex(dir, opts.extensions)
  if (resolved) {
    return { id: resolved }
  }
  return null
}

/**
 * LOAD_AS_DIRECTORY 1.c. - 1.e.
 */
async function loadMainField(
  dir: string,
  fieldName: string,
  fieldValue: string,
  opts: RequiredInternalResolveOptions
): Promise<{ id: string } | { error: string }> {
  // 1.c.
  const joined = normalizePath(path.resolve(dir, fieldValue))
  const joinedStat = await fsStat(joined)
  // 1.d. (no extension)
  if (joinedStat?.isFile()) {
    return { id: joined }
  }
  // 1.d. (with extension)
  const resolvedF = await loadAsFile(dir, opts.extensions)
  if (resolvedF) {
    return { id: resolvedF }
  }
  // 1.e.
  if (joinedStat) {
    const resolvedE = await loadIndex(joined, opts.extensions)
    if (resolvedE) {
      return { id: resolvedE }
    }
  }

  return {
    error: `${JSON.stringify(
      fieldName
    )} field exists in package.json of ${JSON.stringify(
      dir
    )} but doesn't resolve to any file.`
  }
}

export async function loadNodeModules(
  pkgName: string,
  subpath: string,
  importer: string,
  opts: RequiredInternalResolveOptions,
  external: boolean
): Promise<ResolveResult> {
  const importerDir = normalizePath(path.dirname(importer))
  const dirs = nodeModulesPaths(importerDir)
  for (const dir of dirs) {
    // 2.1.
    const resolvedE = await loadPackageExports(pkgName, subpath, dir, opts)
    if (resolvedE) {
      if (external) {
        return resolveExternalized(resolvedE, `${pkgName}${subpath}`)
      }
      return resolvedE
    }

    const joined = normalizePath(path.join(dir, pkgName, subpath))
    // 2.2. and 2.3.
    const resolvedF = await loadAsFileOrDirectory(joined, subpath !== '.', opts)
    if (resolvedF) {
      if (external) {
        return resolveExternalized(resolvedF)
      }
      return resolvedF
    }
  }
  return null
}

function* nodeModulesPaths(inputDir: string): Generator<string, void> {
  const dir = inputDir.endsWith('/') ? inputDir.slice(0, -1) : inputDir
  let slashIndex = dir.length
  while (slashIndex > 0) {
    const former = dir.slice(0, slashIndex)
    if (!former.endsWith('/node_modules')) {
      yield former + '/node_modules'
    }

    slashIndex = dir.lastIndexOf('/', slashIndex - 1)
  }
}

async function loadPackageExports(
  pkgName: string,
  subpath: string,
  dir: string,
  opts: RequiredInternalResolveOptions
): Promise<ResolveResult> {
  const pkgDir = normalizePath(path.join(dir, pkgName))
  const pkgJson = await readPackageJson(pkgDir)
  if (!pkgJson || !pkgJson.exports) return null

  // 5.
  return await resolvePackageExports(
    pkgDir,
    pkgJson,
    subpath,
    opts.conditions,
    opts.preserveSymlinks
  )
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
  // loadAsFile (no extension)
  if (joinedStat?.isFile()) {
    if (enableFile) {
      return { id: dir }
    }
    return null
  }

  if (enableFile) {
    // loadAsFile (with extension)
    const resolved = await loadAsFile(dir, opts.extensions)
    if (resolved) {
      return { id: resolved }
    }
  }

  if (joinedStat) {
    // loadAsDir
    const resolved = await loadAsDirectory(dir, opts)
    if (resolved) {
      return resolved
    }
  }
  return null
}

/**
 * doesn't exist in CJS require spec
 */
export async function resolveNestedSelectedPackages(
  id: string,
  importer: string
): Promise<[id: string, importer: string]> {
  // split id by last '>' for nested selected packages, for example:
  // 'foo > bar > baz' => 'foo > bar' & 'baz'
  // 'foo'             => ''          & 'foo'
  const lastArrowIndex = id.lastIndexOf('>')
  const nestedRoot = id.substring(0, lastArrowIndex).trim()
  const nestedPath = id.substring(lastArrowIndex + 1).trim()

  const pkgNames = nestedRoot.split('>').map((pkg) => pkg.trim())
  let currentBaseDir = normalizePath(path.dirname(importer))
  for (const pkgName of pkgNames) {
    const dirs = nodeModulesPaths(currentBaseDir)
    for (const dir of dirs) {
      const pkgDir = normalizePath(path.join(dir, pkgName))
      const pkgJson = await readPackageJson(pkgDir)
      if (pkgJson) {
        currentBaseDir = dir
        break
      }
    }
  }
  return [nestedPath, currentBaseDir]
}
