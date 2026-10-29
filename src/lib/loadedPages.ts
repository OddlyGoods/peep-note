// Refresh the pages already on screen without collapsing a long list to page 1.
export async function refreshLoadedPages<T extends { id: string }>(
  pageCount: number,
  pageSize: number,
  fetchPage: (page: number) => Promise<T[]>,
) {
  const items: T[] = []
  const seen = new Set<string>()
  let page = 1
  let hasMore = false
  for (; page <= Math.max(1, pageCount); page++) {
    const rows = await fetchPage(page)
    for (const row of rows) {
      if (!seen.has(row.id)) { items.push(row); seen.add(row.id) }
    }
    hasMore = rows.length === pageSize
    if (!hasMore || page === Math.max(1, pageCount)) break
  }
  return { items, page, hasMore }
}
