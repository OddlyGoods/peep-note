// Print finding locations only. Credential values never appear in audit output.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const repoArgument = process.argv.indexOf('--repo')
const root = path.resolve(repoArgument >= 0 ? process.argv[repoArgument + 1] : path.join(__dirname, '..'))
const historyOnly = process.argv.includes('--history-only')
const rules = [
  ['GitHub credential', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/g],
  ['Provider credential', /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,}|GOCSPX-[A-Za-z0-9_-]{20,})\b/g],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['JWT value', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
  ['Hardcoded verifier key', /TextEncoder\(\)\.encode\(['"][A-Za-z0-9+/=_-]{32,}['"]\)/g],
  ['Literal credential assignment', /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|password)\s*[:=]\s*['"][A-Za-z0-9+/=_-]{28,}['"]/gi],
  ['Private user path', /(?:\/home\/|C:\\Users\\)[A-Za-z0-9_.-]+(?:\/|\\)/g],
  ['Email address', /[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g]
]
const findings = []
let files = 0
let blobs = 0
function scan(buffer, location) {
  if (buffer.includes(0)) return
  const source = buffer.toString('utf8')
  for (const [label, pattern] of rules) {
    pattern.lastIndex = 0
    for (const match of source.matchAll(pattern)) {
      if (label === 'Email address' && (match[0] === 'noreply@github.com' || /@(?:users\.noreply\.github\.com|example\.(?:com|org|net|invalid)|test\.invalid)$/i.test(match[0]))) continue
      const line = source.slice(0, match.index).split('\n').length
      findings.push({ label, location, line })
    }
  }
}
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'dist', 'dist-electron', 'release', '.claude'].includes(entry.name)) continue
    const absolute = path.join(directory, entry.name)
    const relative = path.relative(root, absolute)
    if (entry.isDirectory()) walk(absolute)
    else if (entry.isFile()) {
      if (/^(?:\.env(?:\..*)?|\.npmrc)$/.test(entry.name) && entry.name !== '.env.example') findings.push({ label: 'Local configuration file', location: relative, line: 1 })
      if (/\.(?:db(?:-.*)?|sqlite\w*|pem|p12|pfx)$/.test(entry.name)) findings.push({ label: 'Private data file', location: relative, line: 1 })
      if (fs.statSync(absolute).size > 4 * 1024 * 1024) continue
      files++
      scan(fs.readFileSync(absolute), relative)
    }
  }
}
function git(args, options = {}) { return execFileSync('git', args, { cwd: root, maxBuffer: 128 * 1024 * 1024, ...options }) }
if (!historyOnly) walk(root)
const objects = git(['rev-list', '--objects', '--all']).toString('utf8').trim().split('\n').filter(Boolean)
const names = new Map(objects.map(line => [line.split(' ')[0], line.slice(line.indexOf(' ') + 1)]))
if (objects.length) {
  // Demo GIFs can make the complete history exceed execFileSync's output
  // buffer. Scan bounded batches instead of loading all Git objects at once.
  const metadata = git(['cat-file', '--batch-check'], { input: objects.map(line => line.split(' ')[0]).join('\n') + '\n' }).toString('utf8').trim().split('\n')
  let batch = []
  let bytes = 0
  function scanBatch() {
    if (!batch.length) return
    const output = git(['cat-file', '--batch'], { input: batch.join('\n') + '\n', maxBuffer: Math.max(128 * 1024 * 1024, bytes + 1024 * 1024) })
    let offset = 0
    while (offset < output.length) {
      const end = output.indexOf(10, offset)
      const [hash, , size] = output.subarray(offset, end).toString('utf8').split(' ')
      const length = Number(size)
      offset = end + 1
      blobs++
      scan(output.subarray(offset, offset + length), `history:${hash.slice(0, 8)}:${names.get(hash)}`)
      offset += length + 1
    }
    batch = []
    bytes = 0
  }
  for (const line of metadata) {
    const [hash, type, size] = line.split(' ')
    if (type !== 'blob') continue
    const length = Number(size) + 100
    if (bytes + length > 16 * 1024 * 1024) scanBatch()
    batch.push(hash)
    bytes += length
  }
  scanBatch()
}
for (const commit of git(['log', '--all', '--format=%h%x09%ae%x09%ce']).toString('utf8').trim().split('\n').filter(Boolean)) {
  const [hash, ...emails] = commit.split('\t')
  if (emails.some(email => !email.endsWith('@users.noreply.github.com') && email !== 'noreply@github.com')) findings.push({ label: 'Non-noreply commit email', location: `commit:${hash}`, line: 1 })
}
console.log(JSON.stringify({ rootName: path.basename(root), files, historicalBlobs: blobs, findings }, null, 2))
process.exitCode = findings.length ? 1 : 0
