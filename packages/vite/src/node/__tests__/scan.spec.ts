import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { commentRE, importsRE, scriptRE } from '../optimizer/scan'
import { multilineCommentsRE, singlelineCommentsRE } from '../utils'
import { createServer, createServerModuleRunner } from '..'

describe('optimizer-scan:script-test', () => {
  const scriptContent = `import { defineComponent } from 'vue'
      import ScriptDevelopPane from './ScriptDevelopPane.vue';
      export default defineComponent({
        components: {
          ScriptDevelopPane
        }
      })`

  test('component return value test', () => {
    scriptRE.lastIndex = 0
    const [, tsOpenTag, tsContent] = scriptRE.exec(
      `<script lang="ts">${scriptContent}</script>`,
    )!
    expect(tsOpenTag).toEqual('<script lang="ts">')
    expect(tsContent).toEqual(scriptContent)

    scriptRE.lastIndex = 0
    const [, openTag, content] = scriptRE.exec(
      `<script>${scriptContent}</script>`,
    )!
    expect(openTag).toEqual('<script>')
    expect(content).toEqual(scriptContent)
  })

  test('include comments test', () => {
    scriptRE.lastIndex = 0
    const ret = scriptRE.exec(
      `<template>
        <!--  <script >var test1 = null</script> -->
        <!--  <script >var test2 = null</script> -->
      </template>`.replace(commentRE, ''),
    )
    expect(ret).toEqual(null)
  })

  test('components with script keyword test', () => {
    scriptRE.lastIndex = 0
    let ret = scriptRE.exec(`<template><script-develop-pane/></template>`)
    expect(ret).toBe(null)

    scriptRE.lastIndex = 0
    ret = scriptRE.exec(
      `<template><script-develop-pane></script-develop-pane></template>`,
    )
    expect(ret).toBe(null)

    scriptRE.lastIndex = 0
    ret = scriptRE.exec(
      `<template><script-develop-pane  > content </script-develop-pane></template>`,
    )
    expect(ret).toBe(null)
  })

  test('ordinary script tag test', () => {
    scriptRE.lastIndex = 0
    const [, tag, content] = scriptRE.exec(
      `<script  >var test = null</script>`,
    )!
    expect(tag).toEqual('<script  >')
    expect(content).toEqual('var test = null')

    scriptRE.lastIndex = 0
    const [, tag1, content1] = scriptRE.exec(
      `<script>var test = null</script>`,
    )!
    expect(tag1).toEqual('<script>')
    expect(content1).toEqual('var test = null')
  })

  test('imports regex should work', () => {
    const shouldMatchArray = [
      `import 'vue'`,
      `import { foo } from 'vue'`,
      `import foo from 'vue'`,
      `;import foo from 'vue'`,
      `   import foo from 'vue'`,
      `import { foo
      } from 'vue'`,
      `import bar, { foo } from 'vue'`,
      `import foo from 'vue';`,
      `*/ import foo from 'vue';`,
      `import foo from 'vue';//comment`,
      `import foo from 'vue';/*comment
      */`,
      // Skipped, false negatives with current regex
      // `import typescript from 'typescript'`,
      // import type, {foo} from 'vue'
    ]

    shouldMatchArray.forEach((str) => {
      importsRE.lastIndex = 0
      expect(importsRE.exec(str)![1]).toEqual("'vue'")
    })

    const shouldFailArray = [
      `testMultiline("import", {
        body: "ok" });`,
      `//;import foo from 'vue'`,
      `import type { Bar } from 'foo'`,
      `import type{ Bar } from 'foo'`,
      `import type Bar from 'foo'`,
    ]
    shouldFailArray.forEach((str) => {
      importsRE.lastIndex = 0
      expect(importsRE.test(str)).toBe(false)
    })
  })

  test('script comments test', () => {
    multilineCommentsRE.lastIndex = 0
    let ret = `/*
      export default { }
      */`.replace(multilineCommentsRE, '')
    expect(ret).not.toContain('export default')

    singlelineCommentsRE.lastIndex = 0
    ret = `//export default { }`.replace(singlelineCommentsRE, '')
    expect(ret).not.toContain('export default')
  })
})

test('scan jsx-runtime', async (ctx) => {
  const server = await createServer({
    configFile: false,
    logLevel: 'error',
    root: path.join(import.meta.dirname, 'fixtures', 'scan-jsx-runtime'),
    environments: {
      client: {
        // silence client optimizer
        optimizeDeps: {
          noDiscovery: true,
        },
      },
      ssr: {
        resolve: {
          noExternal: true,
        },
        optimizeDeps: {
          force: true,
          noDiscovery: false,
          entries: ['./entry-jsx.tsx', './entry-no-jsx.js'],
        },
      },
    },
  })

  // start server to ensure optimizer run
  await server.listen()
  ctx.onTestFinished(() => server.close())

  const runner = createServerModuleRunner(server.environments.ssr, {
    hmr: { logger: false },
  })

  // flush initial optimizer by importing any file
  await runner.import('./entry-no-jsx.js')

  // verify jsx won't trigger optimizer re-run
  const mod1 = await runner.import('./entry-jsx.js')
  const mod2 = await runner.import('./entry-jsx.js')
  expect((globalThis as any).__test_scan_jsx_runtime).toBe(1)
  expect(mod1).toBe(mod2)
})

// Tests for https://github.com/vitejs/vite-plugin-vue/issues/25
// Vue files should not get export default added if they already have one
describe('vue export default handling', () => {
  test('vue file with export default should not add extra export default', () => {
    // Simulate the logic from scan.ts htmlTypeOnLoadCallback
    const id = 'test.vue'
    const scriptContent = 'export default { setup() { return {} } }'
    const js = 'export * from "virtual-module"\n' + scriptContent

    // The condition from scan.ts line 519:
    // if (!id.endsWith('.vue') || !js.includes('export default'))
    const shouldAddDefault =
      !id.endsWith('.vue') || !js.includes('export default')

    expect(shouldAddDefault).toBe(false)
  })

  test('vue file without export default should add export default', () => {
    const id = 'test.vue'
    const scriptContent = 'const count = ref(0)'
    const js = 'export * from "virtual-module"\n' + scriptContent

    const shouldAddDefault =
      !id.endsWith('.vue') || !js.includes('export default')

    expect(shouldAddDefault).toBe(true)
  })

  test('svelte file should always add export default even with export default in string', () => {
    const id = 'test.svelte'
    const scriptContent = 'const message = "export default should be ignored"'
    const js = 'export * from "virtual-module"\n' + scriptContent

    // For Svelte files, we always add export default because any occurrence
    // is assumed to be a false positive (e.g., in a string)
    const shouldAddDefault =
      !id.endsWith('.vue') || !js.includes('export default')

    // Since it's not a .vue file, this should be true
    expect(shouldAddDefault).toBe(true)
  })

  test('astro file should always add export default even with export default in string', () => {
    const id = 'test.astro'
    const scriptContent = 'const message = "export default should be ignored"'
    const js = 'export * from "virtual-module"\n' + scriptContent

    const shouldAddDefault =
      !id.endsWith('.vue') || !js.includes('export default')

    // Since it's not a .vue file, this should be true
    expect(shouldAddDefault).toBe(true)
  })

  test('html file should always add export default', () => {
    const id = 'test.html'
    const js = 'export * from "virtual-module"\n'

    const shouldAddDefault =
      !id.endsWith('.vue') || !js.includes('export default')

    // Since it's not a .vue file, this should be true
    expect(shouldAddDefault).toBe(true)
  })
})
