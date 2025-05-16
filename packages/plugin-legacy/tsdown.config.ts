import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  target: 'node20',
  outputOptions(opts, format) {
    if (format === 'cjs') {
      opts.exports = 'named'
    }
    return opts
  },
})
