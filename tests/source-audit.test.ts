import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

test('privacy audit accepts example.test fixtures in current files and history but still detects other email and credentials', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'peepnote-audit-test-'))
  const git = (...args: string[]) => execFileSync('git', [
    '-c', 'user.name=Audit test', '-c', 'user.email=noreply@github.com',
    '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${path.join(root, 'no-hooks')}`, ...args
  ], { cwd: root, stdio: 'pipe' })
  const audit = () => {
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/audit-source.cjs'), '--repo', root], { encoding: 'utf8' })
    assert.equal(result.error, undefined)
    return { status: result.status, report: JSON.parse(result.stdout), output: result.stdout }
  }
  try {
    git('init', '-q', '--initial-branch=main')
    const file = path.join(root, 'fixture.txt')
    fs.writeFileSync(file, 'http://user:password@example.test/v1\n')
    git('add', '.'); git('commit', '-qm', 'Add example fixture')
    let result = audit()
    assert.equal(result.status, 0)
    assert.deepEqual(result.report.findings, [])
    assert.ok(result.report.historicalBlobs > 0)

    // Synthetic negative fixtures are generated at runtime, never real secrets.
    const email = ['person', 'private.invalid'].join('@')
    const credential = 'sk-' + 'A'.repeat(24)
    fs.appendFileSync(file, `${email}\n${credential}\n`)
    result = audit()
    assert.equal(result.status, 1)
    assert.deepEqual(result.report.findings.map((finding: any) => finding.label).sort(), ['Email address', 'Provider credential'])
    git('add', '.'); git('commit', '-qm', 'Add synthetic negative fixtures')
    fs.writeFileSync(file, 'http://user:password@example.test/v1\n')
    git('add', '.'); git('commit', '-qm', 'Remove negative fixtures from current tree')
    result = audit()
    assert.equal(result.status, 1)
    assert.deepEqual(result.report.findings.map((finding: any) => finding.label).sort(), ['Email address', 'Provider credential'])
    assert.ok(result.report.findings.every((finding: any) => finding.location.startsWith('history:')))
    assert.equal(result.output.includes(email), false)
    assert.equal(result.output.includes(credential), false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
