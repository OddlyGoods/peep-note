export const EMBEDDING_MODEL = 'Xenova/multilingual-e5-small'
export const EMBEDDING_REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78'
export const EMBEDDING_DIMENSIONS = 384
export const EMBEDDING_CACHE_KEY = `${EMBEDDING_MODEL}@${EMBEDDING_REVISION}:q8:mean:text-v1`
export type EmbeddingState = {
  stage: 'idle' | 'downloading' | 'indexing' | 'ready' | 'error'
  completed: number; total: number; progress?: number; errorCode?: string
}
export type SemanticConnection = { source: string; target: string; similarity: number }

export const SEMANTIC_SEARCH_LIMIT = 50
// Retrieval is less restrictive than note-to-note edges. Keep a score floor
// and a margin from the best match instead of forcing unrelated top-k results.
export function semanticMatches(query: number[], vectors: Map<string, number[]>) {
  const matches = [...vectors].filter(([, vector]) => vector.length === query.length)
    .map(([id, vector]) => ({ id, score: vector.reduce((sum, value, i) => sum + value * query[i], 0) }))
    .filter(match => Number.isFinite(match.score))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  const threshold = Math.max(0.75, (matches[0]?.score ?? 0) - 0.08)
  return matches.filter(match => match.score >= threshold)
}

export function normalizedVector(input: ArrayLike<number>): number[] | null {
  if (!input.length || !Array.from(input).every(Number.isFinite)) return null
  const length = Math.hypot(...Array.from(input))
  return length > 0 ? Array.from(input, value => value / length) : null
}

function closestNeighbours(items: { id: string; score: number }[], neighbours: number) {
  items.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  const median = items.length >= 6 ? items[Math.floor(items.length / 2)].score : 0
  const threshold = Math.max(0.82, Math.min(median + 0.025, (items[0]?.score ?? 0) - 0.01))
  return items.filter(item => item.score >= threshold).slice(0, neighbours)
}

// Check only the source and its top candidates rather than constructing the
// entire graph for every detail view. Uses exactly the map's mutual-edge rule.
export function relatedSemanticNotes(id: string, vectors: Map<string, number[]>, neighbours = 3) {
  const nearest = (source: string) => {
    const vector = vectors.get(source)
    if (!vector) return []
    return closestNeighbours([...vectors].filter(([other, values]) => other !== source && values.length === vector.length)
      .map(([other, values]) => ({ id: other, score: vector.reduce((sum, value, i) => sum + value * values[i], 0) })), neighbours)
  }
  return nearest(id).filter(match => nearest(match.id).some(other => other.id === id))
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
    chosen.set(id, new Map(closestNeighbours(items, neighbours).map(item => [item.id, item.score])))
  }
  const edges: SemanticConnection[] = []
  for (const [a, matches] of chosen) for (const [b, score] of matches) {
    if (a < b && chosen.get(b)?.has(a)) edges.push({ source: a, target: b, similarity: Math.min(1, Math.max(0, score)) })
  }
  return edges
}

const EMBEDDING_ERRORS = new Set([
  'LOCAL_EMBEDDING_NATIVE_MODULE_LOAD_FAILED', 'LOCAL_EMBEDDING_MODEL_LOAD_FAILED',
  'LOCAL_EMBEDDING_INFERENCE_FAILED', 'LOCAL_EMBEDDING_INVALID_VECTOR',
  'LOCAL_EMBEDDING_PROCESS_FAILED', 'LOCAL_EMBEDDING_PROCESS_EXIT', 'LOCAL_EMBEDDING_TIMEOUT',
  'LOCAL_EMBEDDING_CANCELLED', 'INVALID_EMBEDDING', 'EMBEDDING_BUSY',
])
export function embeddingErrorCode(error: unknown): string {
  return error instanceof Error && EMBEDDING_ERRORS.has(error.message) ? error.message : 'LOCAL_EMBEDDING_FAILED'
}
