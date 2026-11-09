export const EMBEDDING_MODEL = 'Xenova/multilingual-e5-small'
export const EMBEDDING_REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78'
export const EMBEDDING_DIMENSIONS = 384
export const EMBEDDING_CACHE_KEY = `${EMBEDDING_MODEL}@${EMBEDDING_REVISION}:q8:mean:text-v1`
export type EmbeddingState = {
  stage: 'idle' | 'downloading' | 'indexing' | 'ready' | 'error'
  completed: number; total: number; progress?: number
}
export type SemanticConnection = { source: string; target: string; similarity: number }

export function normalizedVector(input: ArrayLike<number>): number[] | null {
  if (!input.length || !Array.from(input).every(Number.isFinite)) return null
  const length = Math.hypot(...Array.from(input))
  return length > 0 ? Array.from(input, value => value / length) : null
}

// Mutual nearest neighbours and a local margin prevent unrelated notes from
// acquiring a connection just because a graph needs edges.
export function semanticConnections(vectors: Map<string, number[]>, neighbours = 3): SemanticConnection[] {
  const entries = [...vectors].sort(([a], [b]) => a.localeCompare(b))
  const candidates = new Map<string, { id: string; score: number }[]>()
  for (const [id] of entries) candidates.set(id, [])
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    const [a, av] = entries[i], [b, bv] = entries[j]
    if (av.length !== bv.length) continue
    const score = av.reduce((sum, value, index) => sum + value * bv[index], 0)
    candidates.get(a)!.push({ id: b, score }); candidates.get(b)!.push({ id: a, score })
  }
  const chosen = new Map<string, Map<string, number>>()
  for (const [id, items] of candidates) {
    items.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    const median = items.length >= 6 ? items[Math.floor(items.length / 2)].score : 0
    const threshold = Math.max(0.82, Math.min(median + 0.025, (items[0]?.score ?? 0) - 0.01))
    chosen.set(id, new Map(items.filter(item => item.score >= threshold).slice(0, neighbours).map(item => [item.id, item.score])))
  }
  const edges: SemanticConnection[] = []
  for (const [a, matches] of chosen) for (const [b, score] of matches) {
    if (a < b && chosen.get(b)?.has(a)) edges.push({ source: a, target: b, similarity: Math.min(1, Math.max(0, score)) })
  }
  return edges
}
