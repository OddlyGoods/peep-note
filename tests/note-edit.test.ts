import assert from 'node:assert/strict'
import test from 'node:test'
import type { Log } from '../src/lib/api'
import { hasNoteChanges, noteForm } from '../src/lib/noteEdit'

const saved = { title: 'Saved title', content: 'Saved content', tags: ['one', 'two'], content_format: 'text', is_secret: false, attachments: ['saved.txt'] } as Log

test('opening an editor without changing it does not need a discard confirmation', () => {
  assert.equal(hasNoteChanges(saved, noteForm(saved), [...saved.attachments]), false)
  const form = noteForm(saved)
  form.tags.push('draft')
  assert.deepEqual(saved.tags, ['one', 'two'], 'editing tags cannot mutate the saved baseline')
})

test('every editable note field and attachment membership participates in discard detection', () => {
  for (const patch of [{ title: 'New title' }, { content: 'Changed' }, { tags: ['two', 'one'] }, { content_format: 'markdown' as const }, { is_secret: true }]) {
    assert.equal(hasNoteChanges(saved, { ...noteForm(saved), ...patch }, saved.attachments), true)
  }
  assert.equal(hasNoteChanges(saved, noteForm(saved), []), true)
  assert.equal(hasNoteChanges(saved, noteForm(saved), [...saved.attachments, 'new.txt']), true)
})

test('undoing changes before Back or Cancel does not leave the note dirty', () => {
  const form = noteForm(saved)
  form.content = 'Temporary edit'
  form.content = saved.content
  assert.equal(hasNoteChanges(saved, form, saved.attachments), false)
  const files = [...saved.attachments, 'temporary.txt'].filter(file => file !== 'temporary.txt')
  assert.equal(hasNoteChanges(saved, form, files), false)
})
