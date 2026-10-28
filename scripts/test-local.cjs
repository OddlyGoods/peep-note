const fs = require('node:fs')
const { transformSync } = require('esbuild')
require.extensions['.ts'] = (module, filename) => module._compile(transformSync(fs.readFileSync(filename, 'utf8'), {
  loader: 'ts', format: 'cjs', target: 'node18', sourcefile: filename,
  supported: { 'dynamic-import': false },
  define: { 'import.meta.env': '{}' }
}).code, filename)
require('../tests/local-profile.test.ts')
require('../tests/data-storage.test.ts')
