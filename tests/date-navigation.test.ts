import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { useLogStore } from '../src/stores/logStore'

function setup(context: TestContext, dateFrom = '2026-10-23', dateTo = '2026-10-29') {
  const previousStorage = globalThis.localStorage
  const previousState = useLogStore.getState()
  const values = new Map<string, string>()
  let reloads = 0
  ;(globalThis as any).localStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }
  useLogStore.setState({ dateFrom, dateTo, autoAdvanceDateRange: false, fixedStartDate: false, fetchLogs: async () => { reloads++ } })
  context.after(() => {
    useLogStore.setState(previousState)
    ;(globalThis as any).localStorage = previousStorage
  })
  const range = () => ({ dateFrom: useLogStore.getState().dateFrom, dateTo: useLogStore.getState().dateTo })
  return { values, range, reloads: () => reloads }
}

test('automatic advancement and a fixed start are independent across all four combinations', context => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-30T12:00:00').getTime() })
  const state = setup(context)
  for (const automatic of [false, true]) {
    for (const fixed of [false, true]) {
      useLogStore.setState({ dateFrom: '2026-10-23', dateTo: '2026-10-29' })
      useLogStore.getState().setDateNavigation({ autoAdvanceDateRange: automatic, fixedStartDate: fixed })
      assert.deepEqual(state.range(), {
        dateFrom: automatic && !fixed ? '2026-10-24' : '2026-10-23',
        dateTo: automatic ? '2026-10-30' : '2026-10-29'
      })
    }
  }
})

test('loading both saved options preserves the original start before the first catch-up', context => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-29T12:00:00').getTime() })
  const state = setup(context, '2026-09-03', '2026-10-10')
  useLogStore.getState().setDateNavigation({ autoAdvanceDateRange: true, fixedStartDate: true })
  assert.deepEqual(state.range(), { dateFrom: '2026-09-03', dateTo: '2026-10-29' })
  assert.deepEqual(JSON.parse(state.values.get('openpeepnote_dashboard_date_range')!), state.range())
  assert.equal(state.reloads(), 1)
})

test('a fixed start survives multiple days and repeated focus checks without duplicate reloads', context => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-29T12:00:00').getTime() })
  const state = setup(context, '2026-09-03')
  useLogStore.getState().setDateNavigation({ autoAdvanceDateRange: true, fixedStartDate: true })
  context.mock.timers.tick(24 * 60 * 60_000)
  useLogStore.getState().syncToday()
  assert.deepEqual(state.range(), { dateFrom: '2026-09-03', dateTo: '2026-10-30' })
  context.mock.timers.tick(7 * 24 * 60 * 60_000)
  useLogStore.getState().syncToday()
  assert.deepEqual(state.range(), { dateFrom: '2026-09-03', dateTo: '2026-11-06' })
  useLogStore.getState().syncToday()
  assert.equal(state.reloads(), 2)
})

test('users can select a new fixed start and later return to a sliding range', context => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-29T12:00:00').getTime() })
  const state = setup(context)
  useLogStore.getState().setDateNavigation({ autoAdvanceDateRange: true, fixedStartDate: true })
  useLogStore.getState().setDateRange('2026-09-15', '2026-10-29')
  context.mock.timers.tick(24 * 60 * 60_000)
  useLogStore.getState().syncToday()
  assert.deepEqual(state.range(), { dateFrom: '2026-09-15', dateTo: '2026-10-30' })
  useLogStore.getState().setDateNavigation({ autoAdvanceDateRange: true, fixedStartDate: false })
  context.mock.timers.tick(24 * 60 * 60_000)
  useLogStore.getState().syncToday()
  assert.deepEqual(state.range(), { dateFrom: '2026-09-16', dateTo: '2026-10-31' })
})

test('a fixed future start does not produce an inverted date range', context => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-29T12:00:00').getTime() })
  const state = setup(context, '2026-11-01', '2026-11-07')
  useLogStore.getState().setDateNavigation({ autoAdvanceDateRange: true, fixedStartDate: true })
  assert.deepEqual(state.range(), { dateFrom: '2026-11-01', dateTo: '2026-11-07' })
  assert.equal(state.reloads(), 0)
})
