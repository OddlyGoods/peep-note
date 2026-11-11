import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initDb, run } from '../server/db'
import { createApiApp } from '../server/index'
import { MapThumbnails, mapImageVersion, mapImagePath } from '../server/mapThumbnails'

test('map thumbnails use one image, preserve privacy, and cache only resized output', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'peepnote-map-thumbs-'))
  try {
    await initDb(root)
    const directory = path.join(root, 'screenshots'); fs.mkdirSync(directory)
    const first = path.join(directory, 'first.png'), second = path.join(directory, 'second.png')
    fs.writeFileSync(first, 'first image'); fs.writeFileSync(second, 'second image')
    run("INSERT INTO logs (id,user_id,file_path,attachments,created_at,updated_at) VALUES ('image','local',?,?,1,1)", [first, JSON.stringify([second])])
    let decodes = 0
    const render = (bytes: Uint8Array) => { decodes++; assert.equal(Buffer.from(bytes).toString(), 'first image'); return new Uint8Array([1, 2, 3]) }
    const app = createApiApp(3848, undefined, undefined, undefined, render)
    const url = 'http://127.0.0.1:3848/api/knowledge-map/thumbnail/image'
    assert.equal((await app.request(url)).status, 404); assert.equal(decodes, 0); assert.equal(mapImagePath('image'), null)
    run("INSERT INTO settings (user_id, note_map_enabled) VALUES ('local', 1)")
    assert.equal(mapImagePath('image'), first)
    const response = await app.request(url)
    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store')
    assert.deepEqual(await response.json(), { image: 'data:image/png;base64,AQID' })
    await app.request(url); assert.equal(decodes, 1, 'decoded thumbnail is cached')
    const map = await (await app.request('http://127.0.0.1:3848/api/knowledge-map')).json() as any
    assert.equal(map.notes.length, 1); assert.ok(map.notes[0].imageVersion)
    assert.equal(JSON.stringify(map).includes(first), false); assert.equal(JSON.stringify(map).includes(second), false)
    for (const change of ["is_secret = 1", "is_secret = 0, deleted_at = 1", "deleted_at = NULL, user_id = 'foreign'"]) {
      run(`UPDATE logs SET ${change} WHERE id = 'image'`)
      assert.equal((await app.request(url)).status, 404); assert.equal(mapImagePath('image'), null)
    }
    assert.equal(decodes, 1)
    assert.equal((await app.request('http://127.0.0.1:3848/api/knowledge-map/thumbnail/missing')).status, 404)
    assert.equal((await app.request(url, { headers: { Origin: 'https://example.test' } })).status, 403)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('linked and corrupt thumbnails cannot expose arbitrary paths or late private data', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'peepnote-map-links-'))
  try {
    await initDb(root)
    run("INSERT INTO settings (user_id, note_map_enabled) VALUES ('local', 1)")
    const file = path.join(root, 'original.png'); fs.writeFileSync(file, 'image')
    run("INSERT INTO logs (id,user_id,attachments,created_at,updated_at) VALUES ('linked','local',?,1,1)", [JSON.stringify([`peepnote-link:${file}`])])
    const cache = new MapThumbnails(() => new Uint8Array([1]))
    assert.deepEqual(await cache.get('linked'), new Uint8Array([1])); assert.equal(mapImagePath('linked'), file)
    run("UPDATE logs SET attachments = ? WHERE id = 'linked'", [JSON.stringify([file])])
    assert.equal(await cache.get('linked'), null, 'an unmanaged unlinked path is not readable'); assert.equal(mapImagePath('linked'), null)
    run("UPDATE logs SET attachments = ? WHERE id = 'linked'", [JSON.stringify([`peepnote-link:${file}`])])
    assert.equal(await new MapThumbnails(() => null).get('linked'), null, 'unsupported images fail without breaking the map')
    assert.equal(await new MapThumbnails(() => { run("UPDATE logs SET is_secret = 1 WHERE id = 'linked'"); return new Uint8Array([1]) }).get('linked'), null)
    assert.equal(mapImageVersion({ attachments: 'invalid' }), undefined)
    assert.equal(mapImageVersion({ attachments: '["report.pdf"]' }), undefined)
    assert.notEqual(mapImageVersion({ attachments: '["one.png"]' }), mapImageVersion({ attachments: '["two.png"]' }))
    assert.equal(mapImageVersion({ file_path: 'first.png', attachments: '["second.png"]' }), mapImageVersion({ file_path: 'first.png' }))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
