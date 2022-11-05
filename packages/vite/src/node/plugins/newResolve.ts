import path from 'node:path'
import {
  DEP_VERSION_RE,
  FS_PREFIX,
  OPTIMIZABLE_ENTRY_RE,
  SPECIAL_QUERY_RE
} from '../constants'
import type { DepsOptimizer } from '../optimizer'
import { optimizedDepInfoFromFile } from '../optimizer'
import type { Plugin } from '../plugin'
import { createResolver, resolveFile } from '../resolver'
import type {
  NodeBuiltinType,
  PostPackageResolveFunction,
  PrePackageResolveFunction
} from '../resolver/options'
import type { SSROptions } from '../ssr'
import {
  fsPathFromId,
  injectQuery,
  isOptimizable,
  normalizePath
} from '../utils'
import {
  browserExternalId,
  nodeModulesInPathRE,
  normalizedClientEntry,
  normalizedEnvEntry,
  optionalPeerDepId,
  tryOptimizedResolve
} from './resolve'

type ResolvePluginOptions = {
  root: string
  mainFields: string[]
  extensions: string[]
  conditions: string[]
  preserveSymlinks: boolean
  preferRelative: boolean

  isProduction: boolean

  isBuild: boolean
  asSrc?: boolean
  ssrConfig?: SSROptions
  /** Resolve using esbuild deps optimization */
  getDepsOptimizer?: (ssr: boolean) => DepsOptimizer | undefined
  shouldExternalize?: (id: string) => boolean | undefined
}

export function overhauledResolvePlugin(
  resolveOptions: ResolvePluginOptions
): Plugin {
  const {
    root,
    preserveSymlinks,

    isProduction,

    asSrc
  } = resolveOptions
  const ssrNoExternal = resolveOptions.ssrConfig?.noExternal

  const resolve = createResolver({
    root,
    mainFields: resolveOptions.mainFields,
    extensions: resolveOptions.extensions,
    conditions: resolveOptions.conditions,
    preserveSymlinks,
    preferRelative: resolveOptions.preferRelative,
    supportNestedSelectedPackages: true,
    shouldExternalize: resolveOptions.shouldExternalize,

    isProduction
  })

  const nodeBuiltinSSRExternal: NodeBuiltinType = (id, importer) => {
    let message = `Cannot bundle Node.js built-in "${id}"`
    message += ` imported from "${JSON.stringify(importer)}"`
    message += `. Consider disabling ssr.noExternal or remove the built-in dependency.`
    return { error: message }
  }
  const nodeBuiltinNonSSR: NodeBuiltinType = isProduction
    ? () => ({ id: browserExternalId })
    : (id) => ({
        id: `${browserExternalId}:${id}`
      })

  return {
    name: 'vite:overhauled-resolve',
    async resolveId(id, importer, resolveOpts) {
      const ssr = resolveOpts?.ssr === true
      const scan = resolveOpts?.scan === true

      // We need to delay depsOptimizer until here instead of passing it as an option
      // the resolvePlugin because the optimizer is created on server listen during dev
      const depsOptimizer = resolveOptions.getDepsOptimizer?.(ssr)

      if (id.startsWith(browserExternalId)) {
        return id
      }

      // resolve pre-bundled deps requests, these could be resolved by
      // tryFileResolve or /fs/ resolution but these files may not yet
      // exists if we are in the middle of a deps re-processing
      if (asSrc && depsOptimizer?.isOptimizedDepUrl(id)) {
        const optimizedPath = id.startsWith(FS_PREFIX)
          ? fsPathFromId(id)
          : normalizePath(path.resolve(root, id.slice(1)))
        return optimizedPath
      }

      if (depsOptimizer && (id.startsWith('./') || id.startsWith('../'))) {
        const baseDir = importer ? path.dirname(importer) : root
        const fsPath = normalizePath(path.resolve(baseDir, id))
        if (depsOptimizer.isOptimizedDepFile(fsPath)) {
          // Optimized files could not yet exist in disk, resolve to the full path
          // Inject the current browserHash version if the path doesn't have one
          if (!fsPath.match(DEP_VERSION_RE)) {
            const browserHash = optimizedDepInfoFromFile(
              depsOptimizer.metadata,
              fsPath
            )?.browserHash
            if (browserHash) {
              return injectQuery(fsPath, `v=${browserHash}`)
            }
          }
          return fsPath
        }
      }

      const ensureVersionQuery = (resolved: string): string => {
        if (
          !resolveOptions.isBuild &&
          depsOptimizer &&
          !(
            resolved === normalizedClientEntry ||
            resolved === normalizedEnvEntry
          )
        ) {
          // Ensure that direct imports of node_modules have the same version query
          // as if they would have been imported through a bare import
          // Use the original id to do the check as the resolved id may be the real
          // file path after symlinks resolution
          const isNodeModule =
            nodeModulesInPathRE.test(normalizePath(id)) ||
            nodeModulesInPathRE.test(normalizePath(resolved))

          if (isNodeModule && !resolved.match(DEP_VERSION_RE)) {
            const versionHash = depsOptimizer.metadata.browserHash
            if (versionHash && isOptimizable(resolved, depsOptimizer.options)) {
              resolved = injectQuery(resolved, `v=${versionHash}`)
            }
          }
        }
        return resolved
      }

      // explicit fs paths that starts with /@fs/*
      if (asSrc && id.startsWith(FS_PREFIX)) {
        const fsPath = fsPathFromId(id)
        const res = await resolveFile(fsPath, undefined, preserveSymlinks)
        if (res && !('error' in res)) {
          return ensureVersionQuery(res.id)
        }
        // always return here even if res doesn't exist since /@fs/ is explicit
        // if the file doesn't exist it should be a 404
        return ensureVersionQuery(fsPath)
      }

      // URL
      // /foo -> /fs-root/foo
      if (asSrc && id.startsWith('/')) {
        const fsPath = path.resolve(root, id.slice(1))
        const res = await resolveFile(fsPath, undefined, preserveSymlinks)
        if (res && !('error' in res)) {
          return res
        }
      }

      // const targetWeb = !ssr || resolveOptions.ssrConfig?.ssrTarget === 'webworker'

      let nodeBuiltin: NodeBuiltinType
      if (ssr) {
        nodeBuiltin = ssrNoExternal ? nodeBuiltinSSRExternal : 'allow-polyfill'
      } else {
        nodeBuiltin = nodeBuiltinNonSSR
      }

      let prePackageResolve: PrePackageResolveFunction | null = null
      if (depsOptimizer && asSrc && !scan) {
        prePackageResolve = async (id, importer, external) => {
          if (external) return null

          const res = await tryOptimizedResolve(depsOptimizer, id, importer)
          if (res) {
            return { id: res }
          }
          return null
        }
      }

      let postPackageResolve: PostPackageResolveFunction | null = null
      if (depsOptimizer) {
        postPackageResolve = (id, resolved, isCJS) => {
          if (resolved.external) return id
          // linked
          if (!resolved.id.includes('node_modules')) {
            return id
          }

          const isJsType = depsOptimizer
            ? isOptimizable(resolved.id, depsOptimizer.options)
            : OPTIMIZABLE_ENTRY_RE.test(resolved.id)

          const exclude = depsOptimizer?.options.exclude
          const include = depsOptimizer?.options.exclude

          const skipOptimization =
            !isJsType ||
            importer?.includes('node_modules') ||
            exclude?.includes(id) ||
            SPECIAL_QUERY_RE.test(resolved.id) ||
            (!resolveOptions.isBuild && ssr) ||
            // Only optimize non-external CJS deps during SSR by default
            (ssr && !isCJS && !include?.includes(id))

          if (!skipOptimization) {
            // this is a missing import, queue optimize-deps re-run and
            // get a resolved its optimized info
            const optimizedInfo = depsOptimizer!.registerMissingImport(
              id,
              resolved.id
            )
            return depsOptimizer!.getOptimizedDepId(optimizedInfo)
          }

          // excluded from optimization
          // Inject a version query to npm deps so that the browser
          // can cache it without re-validation, but only do so for known js types.
          // otherwise we may introduce duplicated modules for externalized files
          // from pre-bundled deps.
          if (!resolveOptions.isBuild) {
            const versionHash = depsOptimizer!.metadata.browserHash
            if (versionHash && isJsType) {
              return injectQuery(resolved.id, `v=${versionHash}`)
            }
          }
          return resolved.id
        }
      }

      // this is passed by @rollup/plugin-commonjs
      const isRequire: boolean =
        resolveOpts?.custom?.['node-resolve']?.isRequire ?? false

      const res = await resolve(id, importer, {
        nodeBuiltin,
        prePackageResolve,
        postPackageResolve,

        isRequire
      })
      return res
    },
    load(id) {
      if (id.startsWith(browserExternalId)) {
        if (isProduction) {
          return `export default {}`
        } else {
          id = id.slice(browserExternalId.length + 1)
          return `\
export default new Proxy({}, {
  get(_, key) {
    throw new Error(\`Module "${id}" has been externalized for browser compatibility. Cannot access "${id}.\${key}" in client code.\`)
  }
})`
        }
      }
      if (id.startsWith(optionalPeerDepId)) {
        if (isProduction) {
          return `export default {}`
        } else {
          const [, peerDep, parentDep] = id.split(':')
          return `throw new Error(\`Could not resolve "${peerDep}" imported by "${parentDep}". Is it installed?\`)`
        }
      }
    }
  }
}
