const fs = require('node:fs')
const { transformSync } = require('esbuild')
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => module._compile(transformSync(fs.readFileSync(filename, 'utf8'), {
    loader: extension === '.tsx' ? 'tsx' : 'ts', jsx: 'automatic', format: 'cjs', target: 'node18', sourcefile: filename
  }).code, filename)
}
require('../tests/updates.test.ts')
