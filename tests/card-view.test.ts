import assert from 'node:assert/strict'
import test from 'node:test'
import { createCardViewStore } from '../src/stores/cardViewStore'

function storage(initial?: string) {
  let value = initial ?? null
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next },
    removeItem: () => { value = null },
    value: () => value
  }
}

test('record and group folds survive a new store instance and return to their defaults when reopened', () => {
  const saved = storage()
  const first = createCardViewStore(saved)
  first.getState().setRecordExpanded('note-a', false)
  first.getState().setRecordExpanded('note-b', false)
  first.getState().setGroupExpanded('group-a', false)
  first.getState().setGroupRecordsExpanded('group-a', true)

  const reopened = createCardViewStore(saved)
  assert.equal(reopened.getState().collapsedRecords['note-a'], true)
  assert.equal(reopened.getState().collapsedRecords['note-b'], true)
  assert.equal(reopened.getState().collapsedGroups['group-a'], true)
  assert.equal(reopened.getState().expandedGroupRecords['group-a'], true)
  assert.equal(reopened.getState().collapsedRecords['new-note'], undefined)
  assert.equal(reopened.getState().collapsedGroups['new-group'], undefined)

  reopened.getState().setRecordExpanded('note-a', true)
  reopened.getState().setGroupExpanded('group-a', true)
  reopened.getState().setGroupRecordsExpanded('group-a', false)
  const again = createCardViewStore(saved)
  assert.equal(again.getState().collapsedRecords['note-a'], undefined)
  assert.equal(again.getState().collapsedRecords['note-b'], true, 'other records keep their own preference')
  assert.deepEqual(again.getState().collapsedGroups, {})
  assert.deepEqual(again.getState().expandedGroupRecords, {})
  assert.equal(saved.value()!.includes('setRecordExpanded'), false, 'persist preferences, not store actions')
})

test('saved preferences cannot replace actions or inject invalid fold values', () => {
  const saved = storage(JSON.stringify({ version: 1, state: {
    collapsedRecords: { valid: true, invalid: 'yes', open: false, '': true },
    collapsedGroups: ['invalid-group'],
    expandedGroupRecords: { group: true },
    setRecordExpanded: 'not a function'
  } }))
  const store = createCardViewStore(saved)
  assert.deepEqual(store.getState().collapsedRecords, { valid: true })
  assert.deepEqual(store.getState().collapsedGroups, {})
  assert.deepEqual(store.getState().expandedGroupRecords, { group: true })
  store.getState().setRecordExpanded('valid', true)
  assert.deepEqual(createCardViewStore(saved).getState().collapsedRecords, {})
})

test('malformed saved JSON falls back to open cards and can be saved again', () => {
  const saved = storage('{broken-json')
  const store = createCardViewStore(saved)
  assert.deepEqual(store.getState().collapsedRecords, {})
  assert.deepEqual(store.getState().collapsedGroups, {})
  store.getState().setRecordExpanded('note', false)
  assert.equal(createCardViewStore(saved).getState().collapsedRecords.note, true)
})

test('bulk folding updates the current records, groups and summary children atomically and persists without changing other lists', () => {
  const saved = storage()
  const store = createCardViewStore(saved)
  store.getState().setRecordExpanded('other-note', false)
  store.getState().setGroupExpanded('other-group', false)
  store.getState().setGroupRecordsExpanded('other-group', true)
  let updates = 0
  const off = store.subscribe(() => updates++)
  const records = ['pinned', 'note', 'summary', 'child', 'child'], groups = ['group']
  store.getState().setListExpanded(records, groups, false)
  assert.equal(updates, 1, 'one state update for the whole list')
  const collapsed = createCardViewStore(saved)
  assert.deepEqual(collapsed.getState().collapsedRecords, { 'other-note': true, pinned: true, note: true, summary: true, child: true })
  assert.deepEqual(collapsed.getState().collapsedGroups, { 'other-group': true, group: true })
  assert.deepEqual(collapsed.getState().expandedGroupRecords, { 'other-group': true })
  store.getState().setListExpanded(records, groups, true)
  assert.equal(updates, 2)
  const expanded = createCardViewStore(saved)
  assert.deepEqual(expanded.getState().collapsedRecords, { 'other-note': true })
  assert.deepEqual(expanded.getState().collapsedGroups, { 'other-group': true })
  assert.deepEqual(expanded.getState().expandedGroupRecords, { 'other-group': true, group: true })
  off()
})
