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
