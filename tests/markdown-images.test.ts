import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { localMarkdownImagePath, markdownImageSource } from '../shared/markdownImages'
import { readMarkdownImage } from '../electron/markdownImages'

test('Markdown images distinguish web URLs, absolute local paths and file URLs', () => {
  assert.equal(markdownImageSource('https://example.test/diagram.png?version=2'), 'https://example.test/diagram.png?version=2')
  assert.equal(markdownImageSource('http://example.test/diagram.jpg'), 'http://example.test/diagram.jpg')
  assert.equal(localMarkdownImagePath('/tmp/참고%20자료.png'), '/tmp/참고 자료.png')
  assert.equal(localMarkdownImagePath('file:///tmp/diagram%20one.png'), '/tmp/diagram one.png')
  assert.equal(localMarkdownImagePath('C:\\notes\\diagram.png'), 'C:\\notes\\diagram.png')
  assert.equal(localMarkdownImagePath('file:///C:/notes/diagram.png'), 'C:/notes/diagram.png')
  for (const source of ['relative.png', '//example.test/a.png', '\\\\server\\a.png', 'file://server/share/a.png', 'javascript:alert(1)', 'data:text/html,<script>', 'app://dist/index.html', '/tmp/a%00.png', '/tmp/a\n.png']) {
    assert.equal(markdownImageSource(source), null, source)
  }
})

test('local Markdown images read raster data only and reject missing, oversized or active files', async context => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'peepnote-markdown-images-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
  const image = path.join(root, '테스트 이미지.png')
  fs.writeFileSync(image, png)
  const expected = `data:image/png;base64,${png.toString('base64')}`
  assert.equal(await readMarkdownImage(image), expected)
  assert.equal(await readMarkdownImage(pathToFileURL(image).href), expected)
  assert.equal(await readMarkdownImage(path.join(root, 'missing.png')), null)
  assert.equal(await readMarkdownImage(root), null)
  assert.equal(await readMarkdownImage('https://example.test/diagram.png'), null, 'network requests never use the filesystem bridge')
  for (const content of ['a private text file', '<svg onload="alert(1)"></svg>', '<html>test</html>']) {
    fs.writeFileSync(image, content)
    assert.equal(await readMarkdownImage(image), null, 'an image extension cannot bypass content checks')
  }
  const handle = fs.openSync(image, 'w')
  fs.ftruncateSync(handle, 32 * 1024 * 1024 + 1)
  fs.closeSync(handle)
  assert.equal(await readMarkdownImage(image), null)
})
