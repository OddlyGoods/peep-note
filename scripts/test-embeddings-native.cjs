// Uses synthetic text, a temporary profile and its own Xvfb display.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { buildSync } = require('esbuild'), { spawnSync } = require('node:child_process')
const asar = require('@electron/asar')
if (process.platform !== 'linux') { console.log('Native embedding regression requires Linux/Xvfb.'); process.exit(0) }
const root = path.resolve(__dirname, '..'), fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'peepnote-local-model-'))
async function main() {
  try {
    for (const [entry, output] of [['server/embeddingWorker.ts', 'client.cjs'], ['shared/localEmbeddings.ts', 'semantic.cjs']]) buildSync({ entryPoints: [path.join(root, entry)], outfile: path.join(fixture, output), bundle: true, format: 'cjs', platform: 'node', external: ['@huggingface/transformers'] })
    const source = path.join(fixture, 'app-source'), copied = new Set()
    function copyPackage(name, from = root) {
      if (copied.has(name)) return
      let file
      try { file = require.resolve(name + '/package.json', { paths: [from] }) } catch {
        try { file = require.resolve(name, { paths: [from] }) } catch {
          const search = require('node:module').createRequire(path.join(from, 'package.json')).resolve.paths(name) || []
          file = search.map(directory => path.join(directory, name, 'package.json')).find(file => fs.existsSync(file))
          if (!file) return
        }
      }
      let directory = path.dirname(file)
      while (!fs.existsSync(path.join(directory, 'package.json')) || JSON.parse(fs.readFileSync(path.join(directory, 'package.json'))).name !== name) {
        const parent = path.dirname(directory); if (parent === directory) throw new Error('Missing package: ' + name); directory = parent
      }
      copied.add(name)
      fs.cpSync(directory, path.join(source, 'node_modules', name), { recursive: true, filter: file => {
        const relative = path.relative(directory, file).replaceAll(path.sep, '/')
        return !(name === 'onnxruntime-node' && relative.startsWith('bin/napi-v3/') && !relative.startsWith(`bin/napi-v3/${process.platform}/${process.arch}`) && relative.split('/').length > 3)
      } })
      const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json')))
      // The bundled CPU entry uses only these external modules.
      const deps = name === '@huggingface/transformers' ? ['onnxruntime-common', 'onnxruntime-node', 'sharp'] : Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })
      for (const dep of deps) copyPackage(dep, directory)
    }
    copyPackage('@huggingface/transformers')
    const archive = path.join(fixture, 'app.asar')
    const unpack = require(path.join(root, 'package.json')).build.asarUnpack.find(pattern => pattern.includes('@huggingface/transformers'))
    await asar.createPackageWithOptions(source, archive, { unpack })
    fs.writeFileSync(path.join(fixture, 'worker.cjs'), fs.readFileSync(path.join(root, 'resources/embedding-worker.cjs'), 'utf8').replace('} catch {', '} catch (error) { console.error(error);'))
    fs.writeFileSync(path.join(fixture, 'options.json'), JSON.stringify({ workerPath: path.join(fixture, 'worker.cjs'), modulePath: require.resolve('@huggingface/transformers'), cacheDir: process.env.PEEPNOTE_EMBEDDING_TEST_CACHE || path.join(os.tmpdir(), 'peepnote-embedding-model-tests'), asarModulePath: path.join(archive, 'node_modules/@huggingface/transformers/dist/transformers.node.cjs') }))
    fs.copyFileSync(path.join(root, 'tests/native-local-embeddings.cjs'), path.join(fixture, 'main.cjs'))
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const result = spawnSync('xvfb-run', ['-a', require('electron'), '--no-sandbox', path.join(fixture, 'main.cjs')], { env, encoding: 'utf8', timeout: 250000, maxBuffer: 2 * 1024 * 1024 })
    if (result.status !== 0 || !result.stdout.includes('LOCAL_EMBEDDING_QA_SUCCESS')) { process.stderr.write(result.stdout + result.stderr); throw result.error || new Error('Native embedding regression failed') }
    console.log(result.stdout.split('\n').filter(line => line.startsWith('LOCAL_EMBEDDING_QA')).join('\n'))
  } finally { fs.rmSync(fixture, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
