import type { Log, LogGroup } from './api'

type Snapshot = { logs: Log[]; groups: LogGroup[] }
const snapshots = new Map<string, Snapshot>()
let revision = 0

export const exploreRevision = () => revision
export function invalidateExploreCache() { revision++; snapshots.clear() }
export function cachedExplore(key: string) {
  const result = snapshots.get(key)
  if (result) { snapshots.delete(key); snapshots.set(key, result) }
  return result
}
export function cacheExplore(key: string, result: Snapshot) {
  snapshots.delete(key)
  snapshots.set(key, result)
  if (snapshots.size > 6) snapshots.delete(snapshots.keys().next().value!)
}
