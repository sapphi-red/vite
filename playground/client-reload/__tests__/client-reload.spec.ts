import path from 'node:path'
import type { Request } from 'playwright-chromium'
import { type ServerOptions, type ViteDevServer, createServer } from 'vite'
import { afterEach, describe, expect, test } from 'vitest'
import { hmrPorts, isServe, page, ports } from '~utils'

let server: ViteDevServer

afterEach(async () => {
  await server?.close()
  process.env.DEBUG = ''
})

async function testClientReload(serverOptions: ServerOptions) {
  process.env.DEBUG = 'vite:*'
  // start server
  server = await createServer({
    root: path.resolve(import.meta.dirname, '..'),
    logLevel: 'info',
    server: {
      strictPort: true,
      ...serverOptions,
    },
  })

  await server.listen()
  const serverUrl = server.resolvedUrls.local[0]

  // open page and wait for connection
  const connectedPromise = page.waitForEvent('console', {
    predicate: (message) => message.text().includes('[vite] connected.'),
    timeout: 5000,
  })
  await page.goto(serverUrl)
  await connectedPromise

  // input state
  await page.locator('input').fill('hello')

  // restart and wait for reconnection after reload
  const reConnectedPromise = page.waitForEvent('console', {
    predicate: (message) => message.text().includes('[vite] connected.'),
    timeout: 5000,
  })
  console.log('before restart')
  await server.restart()
  console.log('after restart')
  await reConnectedPromise
  console.log('reconnected')
  expect(await page.textContent('input')).toBe('')
}

describe.runIf(isServe)('client-reload', () => {
  test('default', async () => {
    await testClientReload({
      port: ports['client-reload'],
    })
  })

  test('custom hmr port', async () => {
    await testClientReload({
      port: ports['client-reload/hmr-port'],
      hmr: {
        port: hmrPorts['client-reload/hmr-port'],
      },
    })
  })

  test('custom hmr port and cross origin isolation', async () => {
    await testClientReload({
      port: ports['client-reload/cross-origin'],
      hmr: {
        port: hmrPorts['client-reload/cross-origin'],
      },
      headers: {
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin',
      },
    })
  })
})
