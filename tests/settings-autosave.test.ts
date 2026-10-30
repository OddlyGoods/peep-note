import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSettingsAutosave, type AutosaveStatus } from '../src/lib/settingsAutosave'

type Preferences = { key: string; language: string; model: string; provider: string }
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

test('typing is debounced per field while a selection saves immediately', async context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const writes: Partial<Preferences>[] = []
  const saver = createSettingsAutosave<Preferences>(async patch => { writes.push(patch) }, () => {})
  saver.schedule({ key: 'partial' }, 100)
  saver.schedule({ key: 'complete' }, 100)
  saver.schedule({ language: 'en' })
  context.mock.timers.tick(30)
  await settle()
  assert.deepEqual(writes, [{ language: 'en' }])
  context.mock.timers.tick(120)
  await settle()
  assert.deepEqual(writes, [{ language: 'en' }, { key: 'complete' }])
})

test('writes remain ordered and edits made during a slow save are retained', async context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const writes: Partial<Preferences>[] = []
  let finish!: () => void
  const saver = createSettingsAutosave<Preferences>(async patch => {
    writes.push(patch)
    if (writes.length === 1) await new Promise<void>(resolve => { finish = resolve })
  }, () => {})
  saver.schedule({ model: 'first', provider: 'openai' })
  context.mock.timers.tick(20)
  await settle()
  saver.schedule({ model: 'latest', provider: 'qwen' })
  context.mock.timers.tick(20)
  await settle()
  assert.deepEqual(writes, [{ model: 'first', provider: 'openai' }])
  finish()
  assert.equal(await saver.flush(), true)
  assert.deepEqual(writes[1], { model: 'latest', provider: 'qwen' })
})

test('a failed save stays retryable and never restores an older value over a newer edit', async context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const writes: Partial<Preferences>[] = [], statuses: AutosaveStatus[] = []
  let reject!: () => void
  const saver = createSettingsAutosave<Preferences>(async patch => {
    writes.push(patch)
    if (writes.length === 1) await new Promise<void>((_, fail) => { reject = () => fail(new Error('offline')) })
  }, state => statuses.push(state))
  saver.schedule({ key: 'old', language: 'ko' })
  context.mock.timers.tick(20)
  await settle()
  saver.schedule({ key: 'new' }, 500)
  reject()
  await settle()
  assert.equal(statuses.at(-1), 'error')
  assert.equal(await saver.flush(), true)
  assert.deepEqual(writes[1], { key: 'new', language: 'ko' })
  assert.equal(statuses.at(-1), 'saved')
})

test('leaving settings flushes text changes, while an unfinished model can be cancelled independently', async () => {
  const writes: Partial<Preferences>[] = []
  const saver = createSettingsAutosave<Preferences>(async patch => { writes.push(patch) }, () => {})
  saver.schedule({ key: 'keep', model: 'unfinished', provider: 'openai' }, 500)
  saver.cancel(['model', 'provider'])
  assert.equal(await saver.flush(), true)
  assert.deepEqual(writes, [{ key: 'keep' }])
  assert.equal(await saver.flush(), true)
  assert.equal(writes.length, 1)
})

test('failed writes report failure and do not loop without a user retry', async context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  let writes = 0
  const statuses: AutosaveStatus[] = []
  const saver = createSettingsAutosave<Preferences>(async () => { writes++; throw new Error('offline') }, state => statuses.push(state))
  saver.schedule({ language: 'en' }, 500)
  assert.equal(await saver.flush(), false)
  context.mock.timers.tick(1000)
  await settle()
  assert.equal(writes, 1)
  assert.equal(statuses.at(-1), 'error')
  assert.equal(await saver.flush(), false)
  assert.equal(writes, 2)
})
