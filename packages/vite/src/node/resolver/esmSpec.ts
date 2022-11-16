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

  const pkgJson = await readPackageJson(packagePath)
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
    const pkgJson = await readPackageJson(packagePath)
    if (pkgJson?.imports) {
      // TODO
    }
    return { error: '' } // TODO
  }
  return { error: '' } // TODO
}

export async function lookupPackageScope(p: string): Promise<string | null> {
  let slashIndex = p.length
  while (slashIndex > 0) {
    const scopePath = p.slice(0, slashIndex)
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

  const pkgJson = await readPackageJson(packagePath)
  if (!pkgJson) return 'commonjs'

  if (pkgJson.type === 'module') {
    return 'module'
  }
  return 'commonjs'
}
