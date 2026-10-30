const fs = require('node:fs')
const { transformSync } = require('esbuild')
require.extensions['.ts'] = (module, filename) => module._compile(transformSync(fs.readFileSync(filename, 'utf8'), {
  loader: 'ts', format: 'cjs', target: 'node18', sourcefile: filename,
  supported: { 'dynamic-import': false },
  define: { 'import.meta.env': '{}', 'import.meta.hot': 'false' }
}).code, filename)
require('../tests/local-profile.test.ts')
require('../tests/data-storage.test.ts')
require('../tests/development-restart.test.ts')
require('../tests/date-navigation.test.ts')
require('../tests/favorites-shortcut.test.ts')
require('../tests/attachment-files.test.ts')
require('../tests/menu-memory.test.ts')
require('../tests/note-edit.test.ts')
require('../tests/explore-loading.test.ts')
