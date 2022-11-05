import type { ResolveResult } from './customUtils'
import { readPackageJson, resolvePackageExports } from './customUtils'
import { fsStat } from './fsUtils'
import type { RequiredInternalResolveOptions } from './options'

export async function packageSelfResolve(
  pkgName: string,
  subpath: string,
  importer: string,
  opts: RequiredInternalResolveOptions
): Promise<ResolveResult> {
  const packagePath = await lookupPackageScope(importer)
  if (packagePath == null) return null

  const pkgJsonResult = await readPackageJson(packagePath)
  if (pkgJsonResult == null || 'error' in pkgJsonResult) return pkgJsonResult

  const pkgJson = pkgJsonResult.result
  if (!pkgJson || !pkgJson.exports) return null

  if (pkgJson.name === pkgName) {
    return await resolvePackageExports(
      packagePath,
      pkgJson,
      subpath,
      opts.conditions,
      opts.preserveSymlinks
    )
  }

  return null
}

export async function packageImportsResolve(
  id: string,
  importer: string,
  opts: RequiredInternalResolveOptions
): Promise<ResolveResult> {
  if (id === '#' || id.startsWith('#/')) {
    return null
  }

  const packagePath = await lookupPackageScope(importer)
  if (packagePath != null) {
    const pkgJsonResult = await readPackageJson(packagePath)
    if (pkgJsonResult == null || 'error' in pkgJsonResult) return pkgJsonResult

    const pkgJson = pkgJsonResult.result
    if (pkgJson?.imports) {
      // TODO
    }
    return { error: '' } // TODO
  }
  return { error: '' } // TODO
}

async function lookupPackageScope(p: string): Promise<string | null> {
  let slashIndex = p.lastIndexOf('/')
  while (slashIndex > 0) {
    const scopePath = p.slice(0, slashIndex - 1)
    if (scopePath.endsWith('/node_modules')) {
      return null
    }
    const pkgJsonPath = `${scopePath}/package.json`
    const stat = await fsStat(pkgJsonPath)
    if (stat) {
      return scopePath
    }

    slashIndex = p.lastIndexOf('/', slashIndex - 1)
  }
  return null
}

export async function esmFileFormat(
  p: string
): Promise<'module' | 'commonjs' | 'json' | null> {
  if (p.endsWith('.mjs')) return 'module'
  if (p.endsWith('.cjs')) return 'commonjs'
  if (p.endsWith('.json')) return 'json'
  if (!p.endsWith('.js')) return null

  const packagePath = await lookupPackageScope(p)
  if (packagePath == null) return 'commonjs'

  const pkgJsonResult = await readPackageJson(packagePath)
  if (!pkgJsonResult || 'error' in pkgJsonResult) return 'commonjs'

  if (pkgJsonResult.result.type === 'module') {
    return 'module'
  }
  return 'commonjs'
}
