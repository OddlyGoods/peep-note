import type { EmbeddingState, SemanticConnection } from './localEmbeddings'
export const KNOWLEDGE_MAP_LIMIT = 400
export type MapNote = {
  id: string; title: string
  workspaceId: string; workspaceName: string; workspaceDefault: boolean
  type: string; createdAt: number
}
export type MapSnapshot = { notes: MapNote[]; connections: SemanticConnection[]; indexing: EmbeddingState; total: number; limit: number }
export type MapNode = { id: string; kind: 'note'; label: string; note: MapNote; x: number; y: number; z: number }
export type MapEdge = { source: string; target: string; similarity: number }
export type KnowledgeGraph = { nodes: MapNode[]; edges: MapEdge[] }
export const emptyMapSnapshot = (): MapSnapshot => ({ notes: [], connections: [], indexing: { stage: 'idle', completed: 0, total: 0 }, total: 0, limit: KNOWLEDGE_MAP_LIMIT })

export function buildKnowledgeGraph(input: MapNote[], connections: SemanticConnection[] = []): KnowledgeGraph {
  const notes = [...new Map(input.map(note => [note.id, note])).values()].slice(0, KNOWLEDGE_MAP_LIMIT).sort((a, b) => a.id.localeCompare(b.id))
  const radius = 110 + Math.sqrt(notes.length) * 13
  const nodes: MapNode[] = notes.map((note, index) => {
    const y = 1 - 2 * (index + 0.5) / Math.max(1, notes.length), angle = index * Math.PI * (3 - Math.sqrt(5))
    return { id: `note:${note.id}`, kind: 'note', label: note.title, note, x: Math.cos(angle) * Math.sqrt(1 - y * y) * radius, y: y * radius, z: Math.sin(angle) * Math.sqrt(1 - y * y) * radius }
  })
  const byId = new Map(nodes.map(node => [node.note.id, node]))
  const unique = new Map<string, MapEdge>()
  for (const edge of connections) {
    if (edge.source === edge.target || !byId.has(edge.source) || !byId.has(edge.target) || !Number.isFinite(edge.similarity)) continue
    const [a, b] = [edge.source, edge.target].sort()
    unique.set(JSON.stringify([a, b]), { source: `note:${a}`, target: `note:${b}`, similarity: Math.max(0, Math.min(1, edge.similarity)) })
  }
  const edges = [...unique.values()].sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target))
  const indexed = new Map(nodes.map(node => [node.id, node]))
  // Similar notes attract each other; bounded repulsion keeps titles readable.
  // Layout is deterministic and runs only when the relationship data changes.
  for (let step = 0; step < 80; step++) {
    const cooling = 1 - step / 100
    for (const edge of edges) {
      const a = indexed.get(edge.source)!, b = indexed.get(edge.target)!
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, distance = Math.max(1, Math.hypot(dx, dy, dz))
      const strength = (distance - (65 + (1 - edge.similarity) * 180)) / distance * 0.04 * cooling
      a.x += dx * strength; a.y += dy * strength; a.z += dz * strength
      b.x -= dx * strength; b.y -= dy * strength; b.z -= dz * strength
    }
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z, distance = Math.max(1, Math.hypot(dx, dy, dz))
      if (distance >= 70) continue
      const strength = (70 - distance) * 0.05 * cooling / distance
      a.x += dx * strength; a.y += dy * strength; a.z += dz * strength
      b.x -= dx * strength; b.y -= dy * strength; b.z -= dz * strength
    }
  }
  return { nodes, edges }
}

export type MapCamera = { yaw: number; pitch: number; zoom: number; panX: number; panY: number }
export const INITIAL_MAP_CAMERA: MapCamera = { yaw: -0.25, pitch: 0.15, zoom: 1, panX: 0, panY: 0 }
export function projectMapNode(node: { x: number; y: number; z: number }, camera: MapCamera, width: number, height: number, extent: number) {
  const x = node.x * Math.cos(camera.yaw) + node.z * Math.sin(camera.yaw)
  const rotatedZ = -node.x * Math.sin(camera.yaw) + node.z * Math.cos(camera.yaw)
  const y = node.y * Math.cos(camera.pitch) - rotatedZ * Math.sin(camera.pitch)
  const z = node.y * Math.sin(camera.pitch) + rotatedZ * Math.cos(camera.pitch)
  const depth = 1100 / (1100 + z)
  const scale = Math.min(width, height) / Math.max(400, extent * 2.7) * camera.zoom
  return { x: width / 2 + x * depth * scale + camera.panX, y: height / 2 + y * depth * scale + camera.panY, z, depth }
}
