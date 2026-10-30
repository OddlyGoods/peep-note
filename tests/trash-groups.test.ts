import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TrashItem } from '../src/lib/api'
import { trashEntries } from '../src/lib/trashGroups'

const item = (id: string, extra: Partial<TrashItem> = {}): TrashItem => ({
  id, title: id, log_type: 'note', is_secret: false, deleted_at: 100, expires_at: 200,
  workspace_name: 'General', workspace_is_default: true, ...extra
})

test('Trash groups only whole-group deletion batches and preserves list order and independent records', () => {
  const items = [item('standalone'), item('a', { trash_group_id: 'g', trash_group_name: 'Research' }),
    item('earlier'), item('summary', { trash_group_id: 'g', trash_group_name: 'Research', log_type: 'summary' }),
    item('b', { trash_group_id: 'other', trash_group_name: 'Research' })]
  const entries = trashEntries(items, '', 'Untitled')
  assert.deepEqual(entries.map(entry => entry.items.map(row => row.id)), [['standalone'], ['a', 'summary'], ['earlier'], ['b']])
  assert.equal(entries[1].name, 'Research')
  assert.equal(entries[1].groupId, 'g')
  assert.equal(entries[2].groupId, null)
})

test('Trash search matches group names or member titles and retains the whole batch for atomic actions', () => {
  const items = [item('private', { is_secret: true, trash_group_id: 'g', trash_group_name: 'Research' }),
    item('AI result', { log_type: 'summary', trash_group_id: 'g', trash_group_name: 'Research' }), item('unrelated')]
  for (const query of [' research ', 'AI RESULT', 'private']) {
    assert.deepEqual(trashEntries(items, query, 'Untitled')[0].items.map(row => row.id), ['private', 'AI result'])
    assert.equal(trashEntries(items, query, 'Untitled').length, 1)
  }
  assert.deepEqual(trashEntries(items, 'missing', 'Untitled'), [])
})
