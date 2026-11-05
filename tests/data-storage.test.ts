import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { prepareDataLocation, scheduleDataLocation, validateDataLocation, DataStorageError } from '../electron/dataStorage'
import { attachmentReference } from '../shared/attachments'
const initSqlJs = require('sql.js')

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'peepnote-storage-'))
  const profile = path.join(root, 'profile')
  const target = path.join(root, 'new location 한글')
  for (const dir of [profile, target, path.join(profile, 'screenshots'), path.join(profile, 'videos'), path.join(profile, 'attachments', 'nested'), path.join(profile, 'ocr-models'), path.join(profile, 'Local Storage')]) fs.mkdirSync(dir, { recursive: true })
  const shot = path.join(profile, 'screenshots', 'shot.png')
  const video = path.join(profile, 'videos', 'clip.webm')
  const attachment = path.join(profile, 'attachments', 'nested', 'read me.txt')
  for (const file of [shot, video, attachment]) fs.writeFileSync(file, `fixture:${file}`)
  fs.writeFileSync(path.join(profile, 'ocr-models', 'model.gz'), 'bundled model cache')
  fs.writeFileSync(path.join(profile, 'Local Storage', 'fixture'), 'browser preferences stay in profile')
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ language: 'ko', hotkeys: { openOverlay: 'Alt+1' } }))
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  db.run('CREATE TABLE logs (id TEXT, file_path TEXT, attachments TEXT, content TEXT, deleted_at INTEGER)')
  db.run('CREATE TABLE settings (user_id TEXT, qwen_api_key TEXT)')
  db.run("INSERT INTO settings VALUES ('local', 'fixture-api-key')")
  db.run('CREATE TABLE workspaces (id TEXT, name TEXT)')
  db.run("INSERT INTO workspaces VALUES ('workspace', 'Private workspace')")
  db.run('INSERT INTO logs VALUES (?, ?, ?, ?, ?)', ['shot', shot, JSON.stringify([attachment, '/outside/unmanaged.txt', attachmentReference(attachment, 'link')]), 'Keep the original text', null])
  db.run('INSERT INTO logs VALUES (?, ?, ?, ?, ?)', ['trash-video', video, '[]', 'Deleted records must move too', 100])
  fs.writeFileSync(path.join(profile, 'open-peep-note.db'), Buffer.from(db.export()))
  db.close()
  return { root, profile, target, shot, video, attachment, SQL, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}

test('storage migration copies the latest disk data and rewrites managed paths including Trash', async () => {
  const f = await fixture()
  try {
    await scheduleDataLocation(f.profile, f.profile, f.target)
    assert.equal(fs.readdirSync(f.target).length, 0, 'scheduling must not copy while the app is running')
    fs.writeFileSync(f.attachment, 'saved just before the old process exited')
    const original = fs.readFileSync(path.join(f.profile, 'open-peep-note.db'))
    const moved = await prepareDataLocation(f.profile)
    assert.deepEqual(moved, { directory: fs.realpathSync(f.target) })
    const db = new f.SQL.Database(fs.readFileSync(path.join(f.target, 'open-peep-note.db')))
    try {
      const rows = db.exec('SELECT id, file_path, attachments, content, deleted_at FROM logs ORDER BY id')[0].values
      assert.equal(rows[0][1], path.join(f.target, 'screenshots', 'shot.png'))
      assert.deepEqual(JSON.parse(String(rows[0][2])), [path.join(f.target, 'attachments', 'nested', 'read me.txt'), '/outside/unmanaged.txt', attachmentReference(f.attachment, 'link')])
      assert.equal(rows[0][3], 'Keep the original text')
      assert.equal(rows[1][1], path.join(f.target, 'videos', 'clip.webm'))
      assert.equal(rows[1][4], 100)
    } finally { db.close() }
    assert.equal(fs.readFileSync(path.join(f.target, 'attachments', 'nested', 'read me.txt'), 'utf8'), 'saved just before the old process exited')
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.target, 'settings.json'), 'utf8')).language, 'ko')
    assert.ok(fs.existsSync(path.join(f.target, 'ocr-models', 'model.gz')))
    assert.ok(!fs.existsSync(path.join(f.target, 'Local Storage')), 'Chromium preferences should remain in the stable profile')
    assert.deepEqual(fs.readFileSync(path.join(f.profile, 'open-peep-note.db')), original, 'the original database is preserved')
    assert.deepEqual(await prepareDataLocation(f.profile), moved, 'the selected directory persists across launches')
  } finally { f.cleanup() }
})

test('folder validation rejects the same folder, nested folders, aliases and nonempty destinations', async () => {
  const f = await fixture()
  try {
    const nested = path.join(f.profile, 'child')
    const other = path.join(f.root, 'custom')
    fs.mkdirSync(nested)
    fs.mkdirSync(other)
    assert.throws(() => validateDataLocation(f.profile, f.profile, f.profile), (e: DataStorageError) => e.code === 'same')
    for (const target of [nested, f.root]) assert.throws(() => validateDataLocation(f.profile, f.profile, target), (e: DataStorageError) => e.code === 'nested')
    fs.writeFileSync(path.join(f.target, 'existing.txt'), 'do not overwrite')
    assert.throws(() => validateDataLocation(f.profile, f.profile, f.target), (e: DataStorageError) => e.code === 'notEmpty')
    assert.throws(() => validateDataLocation(f.profile, f.profile, 'relative/path'), (e: DataStorageError) => e.code === 'unavailable')
    if (process.platform !== 'win32') {
      const alias = path.join(f.root, 'alias')
      fs.symlinkSync(f.profile, alias, 'dir')
      assert.throws(() => validateDataLocation(f.profile, f.profile, alias), (e: DataStorageError) => e.code === 'same')
    }
    assert.equal(validateDataLocation(f.profile, f.profile, other), other)
  } finally { f.cleanup() }
})

test('a destination populated after scheduling is not overwritten and startup falls back to the source', async () => {
  const f = await fixture()
  try {
    await scheduleDataLocation(f.profile, f.profile, f.target)
    fs.writeFileSync(path.join(f.target, 'important.txt'), 'unrelated data')
    assert.deepEqual(await prepareDataLocation(f.profile), { directory: f.profile, error: 'notEmpty' })
    assert.equal(fs.readFileSync(path.join(f.target, 'important.txt'), 'utf8'), 'unrelated data')
    assert.deepEqual(await prepareDataLocation(f.profile), { directory: f.profile }, 'the failed migration is not retried every startup')
  } finally { f.cleanup() }
})

test('copying a corrupt database fails without changing originals or exposing partial target files', async () => {
  const f = await fixture()
  try {
    fs.writeFileSync(path.join(f.profile, 'open-peep-note.db'), 'corrupt database fixture')
    await scheduleDataLocation(f.profile, f.profile, f.target)
    assert.deepEqual(await prepareDataLocation(f.profile), { directory: f.profile, error: 'failed' })
    assert.equal(fs.readFileSync(path.join(f.profile, 'open-peep-note.db'), 'utf8'), 'corrupt database fixture')
    assert.deepEqual(fs.readdirSync(f.target), [])
    assert.ok(!fs.readdirSync(f.root).some(name => name.startsWith('.peepnote-copy-')))
  } finally { f.cleanup() }
})

test('an unavailable custom drive stops startup instead of creating an empty replacement database', async () => {
  const f = await fixture()
  try {
    await scheduleDataLocation(f.profile, f.profile, f.target)
    await prepareDataLocation(f.profile)
    fs.renameSync(f.target, `${f.target}-disconnected`)
    await assert.rejects(prepareDataLocation(f.profile), (e: DataStorageError) => e.code === 'unavailable')
    assert.equal(fs.existsSync(f.target), false)
    assert.ok(fs.existsSync(path.join(f.profile, 'open-peep-note.db')))
  } finally { f.cleanup() }
})

test('a second location change keeps using current data and remaps paths again', async () => {
  const f = await fixture()
  try {
    await scheduleDataLocation(f.profile, f.profile, f.target)
    await prepareDataLocation(f.profile)
    fs.writeFileSync(path.join(f.target, 'settings.json'), JSON.stringify({ language: 'ja' }))
    const final = path.join(f.root, 'second')
    fs.mkdirSync(final)
    await scheduleDataLocation(f.profile, f.target, final)
    assert.deepEqual(await prepareDataLocation(f.profile), { directory: final })
    assert.equal(JSON.parse(fs.readFileSync(path.join(final, 'settings.json'), 'utf8')).language, 'ja')
    const db = new f.SQL.Database(fs.readFileSync(path.join(final, 'open-peep-note.db')))
    try { assert.equal(db.exec("SELECT file_path FROM logs WHERE id = 'shot'")[0].values[0][0], path.join(final, 'screenshots', 'shot.png')) }
    finally { db.close() }
    assert.ok(fs.existsSync(f.shot), 'the first original backup is still present')
  } finally { f.cleanup() }
})

test('links in managed storage cannot copy unrelated files', async () => {
  if (process.platform === 'win32') return
  const f = await fixture()
  try {
    fs.symlinkSync(path.join(f.profile, 'settings.json'), path.join(f.profile, 'attachments', 'linked.json'))
    await scheduleDataLocation(f.profile, f.profile, f.target)
    assert.deepEqual(await prepareDataLocation(f.profile), { directory: f.profile, error: 'failed' })
    assert.deepEqual(fs.readdirSync(f.target), [])
  } finally { f.cleanup() }
})

test('a disk copy failure keeps the original path and removes partial staging files', async () => {
  const f = await fixture()
  const copy = fs.copyFileSync
  try {
    await scheduleDataLocation(f.profile, f.profile, f.target)
    fs.copyFileSync = (() => { throw Object.assign(new Error('Fixture disk full'), { code: 'ENOSPC' }) }) as typeof copy
    assert.deepEqual(await prepareDataLocation(f.profile), { directory: f.profile, error: 'failed' })
    assert.deepEqual(fs.readdirSync(f.target), [])
    assert.ok(fs.existsSync(f.attachment))
    assert.ok(!fs.readdirSync(f.root).some(name => name.startsWith('.peepnote-copy-')))
  } finally { fs.copyFileSync = copy; f.cleanup() }
})

test('a final location preference write failure preserves the source database and active location', async () => {
  const f = await fixture()
  const rename = fs.renameSync
  let injected = false
  try {
    await scheduleDataLocation(f.profile, f.profile, f.target)
    fs.renameSync = ((source, destination) => {
      if (!injected && String(destination) === path.join(f.profile, 'storage-location.json')) {
        injected = true
        throw Object.assign(new Error('Fixture preference write failure'), { code: 'EIO' })
      }
      return rename(source, destination)
    }) as typeof rename
    assert.deepEqual(await prepareDataLocation(f.profile), { directory: f.profile, error: 'failed' })
    assert.equal(injected, true)
    assert.ok(fs.existsSync(path.join(f.profile, 'open-peep-note.db')))
    assert.deepEqual(await prepareDataLocation(f.profile), { directory: f.profile })
  } finally { fs.renameSync = rename; f.cleanup() }
})

test('storage migration remaps comment copies and preserves original link locations', async () => {
  const f = await fixture()
  try {
    const file = path.join(f.profile, 'open-peep-note.db')
    const db = new f.SQL.Database(fs.readFileSync(file))
    db.run('CREATE TABLE comments (id TEXT, attachments TEXT)')
    db.run('INSERT INTO comments VALUES (?, ?)', ['with-files', JSON.stringify([f.attachment, attachmentReference(f.attachment, 'link')])])
    fs.writeFileSync(file, Buffer.from(db.export())); db.close()
    await scheduleDataLocation(f.profile, f.profile, f.target)
    assert.equal((await prepareDataLocation(f.profile)).directory, f.target)
    const copied = new f.SQL.Database(fs.readFileSync(path.join(f.target, 'open-peep-note.db')))
    const value = String(copied.exec('SELECT attachments FROM comments')[0].values[0][0])
    assert.deepEqual(JSON.parse(value), [path.join(f.target, 'attachments', 'nested', 'read me.txt'), attachmentReference(f.attachment, 'link')])
    copied.close()
    assert.ok(fs.existsSync(f.attachment), 'the original profile remains untouched')
  } finally { f.cleanup() }
})

test('a fresh folder has no old notes, workspaces, API keys or media and can switch back to the original profile', async () => {
  const f = await fixture()
  try {
    const originalDb = fs.readFileSync(path.join(f.profile, 'open-peep-note.db'))
    const originalSettings = fs.readFileSync(path.join(f.profile, 'settings.json'))
    await scheduleDataLocation(f.profile, f.profile, f.target, 'new')
    assert.deepEqual(fs.readdirSync(f.target), [], 'nothing changes before restart')
    assert.deepEqual(await prepareDataLocation(f.profile), { directory: f.target })
    const fresh = new f.SQL.Database(fs.readFileSync(path.join(f.target, 'open-peep-note.db')))
    try {
      for (const table of ['logs', 'comments', 'workspaces', 'log_groups', 'settings']) {
        assert.equal(fresh.exec(`SELECT COUNT(*) FROM ${table}`)[0].values[0][0], 0)
      }
    } finally { fresh.close() }
    assert.deepEqual(fs.readdirSync(f.target), ['open-peep-note.db'])
    assert.deepEqual(await prepareDataLocation(f.profile), { directory: f.target }, 'fresh data persists across restarts')
    await scheduleDataLocation(f.profile, f.target, f.profile, 'open')
    assert.deepEqual(await prepareDataLocation(f.profile), { directory: fs.realpathSync(f.profile) })
    assert.deepEqual(fs.readFileSync(path.join(f.profile, 'open-peep-note.db')), originalDb)
    assert.deepEqual(fs.readFileSync(path.join(f.profile, 'settings.json')), originalSettings)
    assert.ok(fs.existsSync(f.shot))
    assert.ok(fs.existsSync(path.join(f.target, 'open-peep-note.db')), 'the demo folder is kept when switching back')
  } finally { f.cleanup() }
})

test('opening existing data switches folders without copying, merging or rewriting either database', async () => {
  const f = await fixture(), other = await fixture()
  try {
    const original = fs.readFileSync(path.join(f.profile, 'open-peep-note.db'))
    const existing = fs.readFileSync(path.join(other.profile, 'open-peep-note.db'))
    await scheduleDataLocation(f.profile, f.profile, other.profile, 'open')
    assert.deepEqual(await prepareDataLocation(f.profile), { directory: fs.realpathSync(other.profile) })
    assert.deepEqual(fs.readFileSync(path.join(f.profile, 'open-peep-note.db')), original)
    assert.deepEqual(fs.readFileSync(path.join(other.profile, 'open-peep-note.db')), existing)
    assert.deepEqual(fs.readdirSync(f.target), [])
    await scheduleDataLocation(f.profile, other.profile, f.profile, 'open')
    assert.deepEqual(await prepareDataLocation(f.profile), { directory: fs.realpathSync(f.profile) })
  } finally { f.cleanup(); other.cleanup() }
})

test('opening invalid data is rejected before scheduling and never overwrites an unrelated or corrupt database', async () => {
  const f = await fixture()
  try {
    const file = path.join(f.target, 'open-peep-note.db')
    for (const content of [null, Buffer.from('corrupt')]) {
      if (content) fs.writeFileSync(file, content)
      await assert.rejects(scheduleDataLocation(f.profile, f.profile, f.target, 'open'), (error: DataStorageError) => error.code === 'invalidData')
      assert.equal(fs.existsSync(path.join(f.profile, 'storage-location.json')), false)
    }
    const unrelated = new f.SQL.Database()
    unrelated.run('CREATE TABLE unrelated (id TEXT)')
    fs.writeFileSync(file, Buffer.from(unrelated.export())); unrelated.close()
    const original = fs.readFileSync(file)
    await assert.rejects(scheduleDataLocation(f.profile, f.profile, f.target, 'open'), (error: DataStorageError) => error.code === 'invalidData')
    assert.deepEqual(fs.readFileSync(file), original)
  } finally { f.cleanup() }
})

test('existing data is checked again after restart and a failed switch stays on the original folder', async () => {
  const f = await fixture(), other = await fixture()
  try {
    await scheduleDataLocation(f.profile, f.profile, other.profile, 'open')
    fs.writeFileSync(path.join(other.profile, 'open-peep-note.db'), 'changed after scheduling')
    assert.deepEqual(await prepareDataLocation(f.profile), { directory: f.profile, error: 'invalidData' })
    assert.deepEqual(await prepareDataLocation(f.profile), { directory: f.profile })
  } finally { f.cleanup(); other.cleanup() }
})

test('fresh data cannot replace files added after scheduling and creation failure leaves the source active', async () => {
  const f = await fixture()
  const write = fs.writeFileSync
  try {
    await scheduleDataLocation(f.profile, f.profile, f.target, 'new')
    fs.writeFileSync(path.join(f.target, 'keep.txt'), 'keep this')
    assert.deepEqual(await prepareDataLocation(f.profile), { directory: f.profile, error: 'notEmpty' })
    assert.equal(fs.readFileSync(path.join(f.target, 'keep.txt'), 'utf8'), 'keep this')
    fs.unlinkSync(path.join(f.target, 'keep.txt'))
    await scheduleDataLocation(f.profile, f.profile, f.target, 'new')
    fs.writeFileSync = ((file, ...args) => {
      if (String(file).includes('.peepnote-copy-')) throw new Error('Fixture disk full')
      return (write as any)(file, ...args)
    }) as typeof write
    assert.deepEqual(await prepareDataLocation(f.profile), { directory: f.profile, error: 'failed' })
    assert.deepEqual(fs.readdirSync(f.target), [])
    assert.ok(!fs.readdirSync(f.root).some(name => name.startsWith('.peepnote-copy-')))
  } finally { fs.writeFileSync = write; f.cleanup() }
})

test('pending migrations from older versions still copy data without a mode field', async () => {
  const f = await fixture()
  try {
    fs.writeFileSync(path.join(f.profile, 'storage-location.json'), JSON.stringify({ directory: f.profile, pending: f.target }))
    assert.deepEqual(await prepareDataLocation(f.profile), { directory: f.target })
    assert.ok(fs.existsSync(path.join(f.target, 'screenshots', 'shot.png')))
  } finally { f.cleanup() }
})
