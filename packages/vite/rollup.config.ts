import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import MagicString from 'magic-string'
import type { Plugin } from 'rolldown'
import { defineConfig } from 'rolldown'
import licensePlugin from './rollupLicensePlugin'

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url)).toString(),
)

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const envConfig = defineConfig({
  input: path.resolve(__dirname, 'src/client/env.ts'),
  // TODO: target: es2020
  platform: 'browser',
  output: {
    dir: path.resolve(__dirname, 'dist'),
    entryFileNames: 'client/env.mjs',
  },
})

const clientConfig = defineConfig({
  input: path.resolve(__dirname, 'src/client/client.ts'),
  // TODO: target: es2020
  platform: 'browser',
  external: ['@vite/env'],
  output: {
    dir: path.resolve(__dirname, 'dist'),
    entryFileNames: 'client/client.mjs',
  },
})

// TODO: `new Set`/`new RegExp` are considered as side-effectful: https://github.com/rolldown/rolldown/issues/2603
const sharedNodeOptions = defineConfig({
  platform: 'node',
  treeshake: {
    moduleSideEffects: [
      {
        test: /acorn|astring/,
        sideEffects: false,
      },
      {
        external: true,
        sideEffects: false,
      },
    ],
    // TODO: not supported
    //   propertyReadSideEffects: false,
    //   tryCatchDeoptimization: false,
  },
  output: {
    dir: './dist',
    entryFileNames: `node/[name].js`,
    chunkFileNames: 'node/chunks/dep-[hash].js',
    exports: 'named',
    format: 'esm',
    externalLiveBindings: false,
    // NOTE: probably not needed for rolldown
    // freeze: false,

    // TODO: https://github.com/rolldown/rolldown/issues/2685
    banner:
      "import { createRequire as ___createRequire } from 'module'; const require = ___createRequire(import.meta.url);",
  },
  onwarn(warning, warn) {
    if (warning.message.includes('Circular dependency')) {
      return
    }
    warn(warning)
  },
})

const nodeConfig = defineConfig({
  ...sharedNodeOptions,
  input: {
    index: path.resolve(__dirname, 'src/node/index.ts'),
    cli: path.resolve(__dirname, 'src/node/cli.ts'),
    constants: path.resolve(__dirname, 'src/node/constants.ts'),
  },
  external: [
    /^vite\//,
    'rollup/parseAst',
    /^tsx\//,
    'sugarss', // postcss-import -> sugarss
    'supports-color',
    'utf-8-validate', // ws
    'bufferutil', // ws
    'typescript', // TODO: not used in output but gets bundled without this https://github.com/rolldown/rolldown/issues/2604
    ...Object.keys(pkg.dependencies),
    ...Object.keys(pkg.peerDependencies),
  ],
  plugins: [
    // Some deps have try...catch require of optional deps, but rollup will
    // generate code that force require them upfront for side effects.
    // Shim them with eval() so rollup can skip these calls.
    shimDepsPlugin({
      'postcss-load-config/src/req.js': [
        {
          src: "const { pathToFileURL } = require('node:url')",
          replacement: `const { fileURLToPath, pathToFileURL } = require('node:url')`,
        },
        {
          src: '__filename',
          replacement: 'fileURLToPath(import.meta.url)',
        },
      ],
      // postcss-import uses the `resolve` dep if the `resolve` option is not passed.
      // However, we always pass the `resolve` option. It also uses `read-cache` if
      // the `load` option is not passed, but we also always pass the `load` option.
      // Remove these two imports to avoid bundling them.
      'postcss-import/index.js': [
        {
          src: 'const resolveId = require("./lib/resolve-id")',
          replacement: 'const resolveId = (id) => id',
        },
        {
          src: 'const loadContent = require("./lib/load-content")',
          replacement: 'const loadContent = () => ""',
        },
      ],
      'postcss-import/lib/parse-styles.js': [
        {
          src: 'const resolveId = require("./resolve-id")',
          replacement: 'const resolveId = (id) => id',
        },
      ],
    }),
    licensePlugin(
      path.resolve(__dirname, 'LICENSE.md'),
      'Vite core license',
      'Vite',
    ),
  ],
})

const moduleRunnerConfig = defineConfig({
  ...sharedNodeOptions,
  input: {
    'module-runner': path.resolve(__dirname, 'src/module-runner/index.ts'),
  },
  external: [
    'lightningcss',
    'rollup/parseAst',
    ...Object.keys(pkg.dependencies),
  ],
  plugins: [bundleSizeLimit(53)],
  output: {
    ...sharedNodeOptions.output,
    minify: true,
  },
})

const cjsConfig = defineConfig({
  ...sharedNodeOptions,
  input: {
    publicUtils: path.resolve(__dirname, 'src/node/publicUtils.ts'),
  },
  // TODO: target node18
  output: {
    ...sharedNodeOptions.output,
    entryFileNames: `node-cjs/entries/[name].cjs`,
    chunkFileNames: 'node-cjs/chunks/dep-[hash].js',
    format: 'cjs',
    banner: undefined,
  },
  external: [...Object.keys(pkg.dependencies), 'supports-color'],
  plugins: [bundleSizeLimit(175)],
})

export default defineConfig([
  envConfig,
  clientConfig,
  nodeConfig,
  moduleRunnerConfig,
  cjsConfig,
])

// #region Plugins

interface ShimOptions {
  src?: string
  replacement: string
  pattern?: RegExp
}

function shimDepsPlugin(deps: Record<string, ShimOptions[]>): Plugin {
  const transformed: Record<string, boolean> = {}

  return {
    name: 'shim-deps',
    transform(code, id) {
      for (const file in deps) {
        if (id.replace(/\\/g, '/').endsWith(file)) {
          for (const { src, replacement, pattern } of deps[file]) {
            const magicString = new MagicString(code)

            if (src) {
              const pos = code.indexOf(src)
              if (pos < 0) {
                this.error(
                  `Could not find expected src "${src}" in file "${file}"`,
                )
              }
              transformed[file] = true
              magicString.overwrite(pos, pos + src.length, replacement)
            }

            if (pattern) {
              let match
              while ((match = pattern.exec(code))) {
                transformed[file] = true
                const start = match.index
                const end = start + match[0].length
                let _replacement = replacement
                for (let i = 1; i <= match.length; i++) {
                  _replacement = _replacement.replace(`$${i}`, match[i] || '')
                }
                magicString.overwrite(start, end, _replacement)
              }
              if (!transformed[file]) {
                this.error(
                  `Could not find expected pattern "${pattern}" in file "${file}"`,
                )
              }
            }

            code = magicString.toString()
          }

          console.log(`shimmed: ${file}`)

          return code
        }
      }
    },
    buildEnd(err) {
      if (!err) {
        for (const file in deps) {
          if (!transformed[file]) {
            this.error(
              `Did not find "${file}" which is supposed to be shimmed, was the file renamed?`,
            )
          }
        }
      }
    },
  }
}

/**
 * Guard the bundle size
 *
 * @param limit size in kB
 */
function bundleSizeLimit(limit: number): Plugin {
  let size = 0

  return {
    name: 'bundle-limit',
    generateBundle(_, bundle) {
      size = Buffer.byteLength(
        Object.values(bundle)
          .map((i) => ('code' in i ? i.code : ''))
          .join(''),
        'utf-8',
      )
    },
    closeBundle() {
      const kb = size / 1000
      if (kb > limit) {
        this.error(
          `Bundle size exceeded ${limit} kB, current size is ${kb.toFixed(
            2,
          )}kb.`,
        )
      }
    },
  }
}

// #endregion
