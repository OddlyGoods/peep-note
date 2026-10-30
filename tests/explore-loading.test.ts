import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { api, type Log, type LogGroup } from '../src/lib/api'
import { useLogStore } from '../src/stores/logStore'
import { useWorkspaceStore } from '../src/stores/workspaceStore'
import { invalidateExploreCache } from '../src/lib/exploreCache'

const rows = (workspace: string) => [{ id: workspace, workspace_id: workspace }] as Log[]
const groups = (workspace: string) => [{ id: `group-${workspace}`, logs: [] }] as unknown as LogGroup[]
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function setup(context: TestContext) {
  const previous = useLogStore.getState()
  const workspace = useWorkspaceStore.getState()
  const list = api.logs.list, groupList = api.groups.list
  const requests: Record<string, { notes: ReturnType<typeof deferred<Log[]>>; groups: ReturnType<typeof deferred<LogGroup[]>> }> = {}
  let calls = 0
  const response = (id: string) => requests[id] ??= { notes: deferred<Log[]>(), groups: deferred<LogGroup[]>() }
  api.logs.list = params => { calls++; return response(params?.workspace_id ?? '').notes.promise }
  api.groups.list = params => response(params?.workspace_id ?? '').groups.promise
  invalidateExploreCache()
  useLogStore.setState({ logs: [], groups: [], queryKey: null, loading: false, revealTarget: null })
  context.after(() => {
    useLogStore.setState({ fetchLogs: async () => {} })
    useWorkspaceStore.setState(workspace)
    api.logs.list = list; api.groups.list = groupList
    useLogStore.setState(previous)
    invalidateExploreCache()
  })
  return {
    requests, calls: () => calls,
    select: (id: string) => { useWorkspaceStore.setState({ selectedId: id }); return useLogStore.getState().fetchLogs() },
    respond: (id: string) => { response(id).notes.resolve(rows(id)); response(id).groups.resolve(groups(id)) }
  }
}

test('workspace notes and groups change atomically and revisits render cached results immediately', async context => {
  const state = setup(context)
  let pending = state.select('a'); state.respond('a'); await pending
  pending = state.select('b')
  assert.deepEqual(useLogStore.getState().logs, [], 'the old workspace is never shown under the new heading')
  assert.deepEqual(useLogStore.getState().groups, [])
  state.requests.b.notes.resolve(rows('b'))
  await Promise.resolve()
  assert.equal(useLogStore.getState().loading, true, 'wait until both parts of the query are ready')
  state.requests.b.groups.resolve(groups('b')); await pending
  pending = state.select('a')
  assert.equal(useLogStore.getState().logs[0].id, 'a')
  assert.equal(useLogStore.getState().groups[0].id, 'group-a')
  assert.equal(useLogStore.getState().loading, false, 'a refresh does not replace cached cards with a spinner')
  await pending
})

test('rapid workspace changes reject stale responses and deduplicate identical concurrent requests', async context => {
  const state = setup(context)
  const first = state.select('slow')
  assert.equal(state.calls(), 1, 'the selection notification and explicit fetch share one request')
  const latest = state.select('fast'); state.respond('fast'); await latest
  state.respond('slow'); await first
  assert.equal(useLogStore.getState().logs[0].id, 'fast')
  assert.equal(useLogStore.getState().groups[0].id, 'group-fast')
  assert.equal(useLogStore.getState().loading, false)
})

test('invalidating workspace results after a mutation prevents stale cache restoration', async context => {
  const state = setup(context)
  let pending = state.select('old'); state.respond('old'); await pending
  pending = state.select('other'); state.respond('other'); await pending
  invalidateExploreCache()
  pending = state.select('old')
  assert.deepEqual(useLogStore.getState().logs, [])
  assert.equal(useLogStore.getState().loading, true)
  await pending
})

test('a mutation during a pending query revalidates before committing the result', async context => {
  const state = setup(context)
  const pending = state.select('changing')
  const old = state.requests.changing
  state.requests.changing = { notes: deferred<Log[]>(), groups: deferred<LogGroup[]>() }
  invalidateExploreCache()
  old.notes.resolve(rows('obsolete')); old.groups.resolve(groups('obsolete'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(state.calls(), 2)
  assert.deepEqual(useLogStore.getState().logs, [])
  state.respond('changing'); await pending
  assert.equal(useLogStore.getState().logs[0].id, 'changing')
})

test('workspace caches are bounded instead of retaining every previously opened query', async context => {
  const state = setup(context)
  for (let index = 0; index < 8; index++) {
    const id = `workspace-${index}`
    const pending = state.select(id); state.respond(id); await pending
  }
  const pending = state.select('workspace-0')
  assert.equal(useLogStore.getState().loading, true, 'an evicted workspace is loaded again')
  await pending
})

test('a successful API mutation invalidates cached workspace results', async context => {
  const { cacheExplore, cachedExplore } = await import('../src/lib/exploreCache')
  const originalFetch = globalThis.fetch
  context.after(() => { globalThis.fetch = originalFetch; invalidateExploreCache() })
  cacheExplore('saved-query', { logs: rows('before-edit'), groups: [] })
  globalThis.fetch = async () => Response.json({ id: 'updated' })
  await api.logs.update('updated', { title: 'Changed title' })
  assert.equal(cachedExplore('saved-query'), undefined)
})
