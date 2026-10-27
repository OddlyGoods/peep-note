// Test TS server modules directly, without building or launching Electron.
const fs = require('node:fs')
const { transformSync } = require('esbuild')
require.extensions['.ts'] = (module, filename) => {
  module._compile(transformSync(fs.readFileSync(filename, 'utf8'), {
    loader: 'ts', format: 'cjs', target: 'node18', sourcefile: filename
  }).code, filename)
}
require('../tests/features.test.ts')
