import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { importLocalAttachments, attachmentFileSize } from '../electron/attachmentFiles'
import { directoryUsage } from '../electron/dataUsage'
import { attachmentFilename, attachmentPath, isImageAttachment, isLinkedAttachment } from '../shared/attachments'

test('linked files use the original without creating a data directory; copies remain independent', async context => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'peepnote-attachments-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, '참고 자료.txt')
  const directory = path.join(root, 'data', 'attachments')
  fs.writeFileSync(source, 'original')
  const [linked] = await importLocalAttachments([{ path: source }], 'link', directory)
  assert.equal(isLinkedAttachment(linked.path), true)
  assert.equal(attachmentPath(linked.path), source)
  assert.equal(attachmentFilename(linked.path), '참고 자료.txt')
  assert.equal(fs.existsSync(directory), false)
  fs.writeFileSync(source, 'updated')
  assert.equal(fs.readFileSync(attachmentPath(linked.path), 'utf8'), 'updated')
  const [copied] = await importLocalAttachments([{ path: source }], 'copy', directory)
  assert.equal(isLinkedAttachment(copied.path), false)
  assert.notEqual(copied.path, source)
  fs.unlinkSync(source)
  assert.equal(fs.existsSync(attachmentPath(linked.path)), false)
  assert.equal(fs.readFileSync(copied.path, 'utf8'), 'updated')
})

test('attachment import rejects directories and invalid modes and preserves image metadata', async context => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'peepnote-attachment-validation-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'diagram.png')
  fs.writeFileSync(source, 'image fixture')
  assert.deepEqual(await importLocalAttachments([{ path: source }], 'invalid', root), [])
  const files = await importLocalAttachments([null, {}, { path: root }, { path: 'relative.txt' }, { path: source }], 'link', root)
  assert.equal(files.length, 1)
  assert.equal(files[0].isImage, true)
  assert.equal(files[0].mimeType, 'image/png')
  assert.equal(isImageAttachment(files[0].path), true)
})

test('data folder usage counts nested files without following links to external files', async context => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'peepnote-usage-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const directory = path.join(root, 'data')
  fs.mkdirSync(path.join(directory, 'nested'), { recursive: true })
  fs.writeFileSync(path.join(directory, '.settings'), '1234')
  fs.writeFileSync(path.join(directory, 'nested', 'note'), '123456')
  const external = path.join(root, 'external')
  fs.writeFileSync(external, 'this original must not be counted')
  if (process.platform !== 'win32') fs.symlinkSync(external, path.join(directory, 'linked'))
  assert.deepEqual(await directoryUsage(directory), { bytes: 10, partial: false })
  assert.deepEqual(await directoryUsage(path.join(root, 'missing')), { bytes: 0, partial: true })
})

test('attachment sizes use real bytes, follow authorized links, and leave copied sizes independent', async context => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'peepnote-file-size-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'sample.txt')
  fs.writeFileSync(source, '한글')
  const [linked] = await importLocalAttachments([{ path: source }], 'link', path.join(root, 'attachments'))
  const [copied] = await importLocalAttachments([{ path: source }], 'copy', path.join(root, 'attachments'))
  const allowed = new Set([linked.path, copied.path])
  const resolve = (reference: string) => allowed.has(reference) ? attachmentPath(reference) : null
  assert.equal(await attachmentFileSize(linked.path, resolve), Buffer.byteLength('한글'))
  fs.writeFileSync(source, 'updated original')
  assert.equal(await attachmentFileSize(linked.path, resolve), Buffer.byteLength('updated original'))
  assert.equal(await attachmentFileSize(copied.path, resolve), Buffer.byteLength('한글'))
  fs.writeFileSync(source, '')
  assert.equal(await attachmentFileSize(linked.path, resolve), 0)
  assert.equal(await attachmentFileSize(source, resolve), null, 'an unauthorized original must not expose metadata')
  assert.equal(await attachmentFileSize(null, resolve), null)
  assert.equal(await attachmentFileSize(root, value => value), null, 'directories are not attachments')
  fs.unlinkSync(source)
  assert.equal(await attachmentFileSize(linked.path, resolve), null, 'missing links are handled without throwing')
})
