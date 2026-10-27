const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const yaml = require('js-yaml')

function verifyVersion(tag = process.env.RELEASE_TAG) {
  const pkg = require('../package.json')
  const lock = require('../package-lock.json')
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/, 'Release requires a stable version')
  assert.equal(lock.version, pkg.version, 'Lockfile version must match package.json')
  assert.equal(lock.packages[''].version, pkg.version)
  if (tag) assert.equal(tag, `v${pkg.version}`, 'Git tag must match package.json version')
  return pkg.version
}

function verifyArtifacts(platform, directory = path.resolve(__dirname, '../release')) {
  const version = verifyVersion()
  const metadata = platform === 'win' ? 'latest.yml' : 'latest-linux.yml'
  const extension = platform === 'win' ? '.exe' : '.deb'
  const info = yaml.load(fs.readFileSync(path.join(directory, metadata), 'utf8'))
  assert.equal(info.version, version, 'Update metadata version must match app version')
  assert.ok(Array.isArray(info.files) && info.files.length, 'Missing update files')
  assert.ok(info.files.some(file => file.url.endsWith(extension)), `Missing ${extension} update`)
  for (const file of info.files) {
    const name = decodeURIComponent(file.url)
    assert.equal(path.basename(name), name, 'Update must reference a local release asset')
    assert.ok(name.endsWith(extension), `Unexpected update type: ${name}`)
    const binary = fs.readFileSync(path.join(directory, name))
    assert.equal(crypto.createHash('sha512').update(binary).digest('base64'), file.sha512, `Checksum mismatch: ${name}`)
    if (file.size !== undefined) assert.equal(binary.length, file.size, `Size mismatch: ${name}`)
    if (platform === 'win') assert.ok(fs.statSync(path.join(directory, `${name}.blockmap`)).size > 0, 'Missing Windows blockmap')
  }
}

module.exports = { verifyVersion, verifyArtifacts }
if (require.main === module) {
  const mode = process.argv[2] || 'version'
  assert.ok(['version', 'linux', 'win'].includes(mode))
  if (mode === 'version') verifyVersion()
  else verifyArtifacts(mode)
  console.log(`Release validation passed: ${mode}`)
}
