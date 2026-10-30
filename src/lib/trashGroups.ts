import type { TrashItem } from './api'

export type TrashEntry = { key: string; groupId: string | null; name: string; items: TrashItem[] }

export function trashEntries(items: TrashItem[], query: string, untitled: string): TrashEntry[] {
  const entries: TrashEntry[] = []
  const groups = new Map<string, TrashEntry>()
  for (const item of items) {
    const groupId = item.trash_group_id || null
    let entry = groupId ? groups.get(groupId) : undefined
    if (!entry) {
      entry = { key: groupId ? `group:${groupId}` : `record:${item.id}`, groupId,
        name: (groupId ? item.trash_group_name : item.title) || untitled, items: [] }
      entries.push(entry)
      if (groupId) groups.set(groupId, entry)
    }
    entry.items.push(item)
  }
  const search = query.trim().toLocaleLowerCase()
  return entries.filter(entry => !search || entry.name.toLocaleLowerCase().includes(search)
    || entry.items.some(item => (item.title || untitled).toLocaleLowerCase().includes(search)))
}
