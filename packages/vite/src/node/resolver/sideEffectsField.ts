// https://webpack.js.org/guides/tree-shaking/#mark-the-file-as-side-effect-free

import { createFilter } from '../publicUtils'
import type { ResolveResult } from './customUtils'
import { readPackageJson } from './customUtils'
import { lookupPackageScope } from './esmSpec'

export async function tryAppendSideEffects<T extends ResolveResult>(
  resolved: T
): Promise<T> {
  if (!resolved || 'error' in resolved) return resolved
  if (resolved.external) return resolved

  const sideEffects = await resolveSideEffects(resolved.id)
  if (sideEffects != null) {
    resolved.moduleSideEffects = sideEffects
  }
  return resolved
}

export async function resolveSideEffects(
  path: string
): Promise<boolean | 'no-treeshake' | null> {
  const packagePath = await lookupPackageScope(path)
  if (!packagePath) return null

  const pkgJson = await readPackageJson(packagePath)
  if (!pkgJson?.sideEffects) return null

  const hasSideEffect = createHasSideEffect(packagePath, pkgJson.sideEffects)
  if (!hasSideEffect) return null

  return hasSideEffect(path) ? 'no-treeshake' : false
}

function createHasSideEffect(
  pkgDirPath: string,
  sideEffectsField: unknown
): ((path: string) => boolean) | null {
  if (typeof sideEffectsField === 'boolean') {
    return () => sideEffectsField
  }

  if (typeof sideEffectsField === 'string') {
    const normalizedSideEffectsField = normalizeSideEffects(sideEffectsField)
    return createFilter(normalizedSideEffectsField, undefined, {
      resolve: pkgDirPath
    })
  }

  if (Array.isArray(sideEffectsField)) {
    const normalizedSideEffectsField =
      sideEffectsField.map(normalizeSideEffects)
    return createFilter(normalizedSideEffectsField, undefined, {
      resolve: pkgDirPath
    })
  }

  return null // invalid
}

function normalizeSideEffects(sideEffects: string) {
  if (!sideEffects.includes('/')) return `**/${sideEffects}`
  return sideEffects
}
