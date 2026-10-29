import assert from 'node:assert/strict'
import test from 'node:test'
import { menuForPath, screenForPath } from '../src/lib/menuMemory'
import { useMenuMemoryStore } from '../src/stores/menuMemoryStore'
import { refreshLoadedPages } from '../src/lib/loadedPages'

test('each list and detail belongs to its own menu; invalid routes are not cached', () => {
  for (const [path, menu, screen] of [
    ['/', '/', 'explore-list'], ['/log/a', '/', 'explore-detail'],
    ['/search/', '/search', 'search-list'], ['/search/log/a', '/search', 'search-detail'],
    ['/favorites', '/favorites', 'favorites-list'], ['/favorites/log/a', '/favorites', 'favorites-detail'],
    ['/trash', '/trash', 'trash'], ['/settings', '/settings', 'settings'],
  ]) {
    assert.equal(menuForPath(path), menu)
    assert.equal(screenForPath(path), screen)
  }
  for (const path of ['/bad', '/log/', '/log/a/extra', '/searching', '/favorites/fake']) {
    assert.equal(menuForPath(path), null)
    assert.equal(screenForPath(path), null)
  }
})

test('menu targets retain the last detail without replaying transient route state', () => {
  useMenuMemoryStore.setState({ targets: {} })
  const remember = useMenuMemoryStore.getState().remember
  remember({ pathname: '/search/log/a', search: '?preview=1', hash: '#content', ...{ state: { revealLogId: 'one-time' }, key: 'transient' } })
  remember({ pathname: '/settings', search: '', hash: '' })
  assert.deepEqual(useMenuMemoryStore.getState().targets['/search'], { pathname: '/search/log/a', search: '?preview=1', hash: '#content' })
  remember({ pathname: '/search', search: '', hash: '' })
  assert.equal(useMenuMemoryStore.getState().targets['/search']?.pathname, '/search')
  assert.equal(useMenuMemoryStore.getState().targets['/settings']?.pathname, '/settings')
})

test('refreshing a cached list keeps all loaded pages and removes boundary duplicates', async () => {
  const calls: number[] = []
  const result = await refreshLoadedPages(3, 2, async page => {
    calls.push(page)
    return [[{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }], [{ id: 'd' }, { id: 'e' }]][page - 1]
  })
  assert.deepEqual(calls, [1, 2, 3])
  assert.deepEqual(result, { items: ['a', 'b', 'c', 'd', 'e'].map(id => ({ id })), page: 3, hasMore: true })
})

test('refresh stops when deletions have reduced the available pages', async () => {
  const calls: number[] = []
  const result = await refreshLoadedPages(4, 2, async page => { calls.push(page); return page === 1 ? [{ id: 'a' }, { id: 'b' }] : [{ id: 'c' }] })
  assert.deepEqual(calls, [1, 2])
  assert.equal(result.page, 2)
  assert.equal(result.hasMore, false)
})

test('failed refresh rejects rather than replacing the cache with partial results', async () => {
  await assert.rejects(refreshLoadedPages(2, 1, async page => {
    if (page === 2) throw new Error('offline')
    return [{ id: 'a' }]
  }), /offline/)
})
