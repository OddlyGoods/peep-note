export const KNOWLEDGE_MAP_LIMIT = 400
export type MapNote = {
  id: string; title: string; excerpt: string; tags: string[]
  groupId: string | null; groupName: string | null
  workspaceId: string; workspaceName: string; workspaceDefault: boolean
  type: string; createdAt: number
}
export type MapSnapshot = { notes: MapNote[]; total: number; limit: number }
export type MapNode = {
  id: string; kind: 'note' | 'group' | 'tag'; label: string
  note?: MapNote; members: string[]; x: number; y: number; z: number
}
export type MapEdge = { source: string; target: string; kind: 'group' | 'tag' }
export type KnowledgeGraph = { nodes: MapNode[]; edges: MapEdge[] }

export function normalizedMapTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((tag): tag is string => typeof tag === 'string')
    .map(tag => tag.trim().normalize('NFKC').replace(/^#+/, '').trim().toLowerCase()).filter(Boolean))]
}

function hash(text: string) {
  let value = 2166136261
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619)
  return value >>> 0
}
function sphere(index: number, count: number, radius: number) {
  const y = 1 - 2 * (index + 0.5) / Math.max(1, count)
  const angle = index * Math.PI * (3 - Math.sqrt(5))
  return { x: Math.cos(angle) * Math.sqrt(1 - y * y) * radius, y: y * radius, z: Math.sin(angle) * Math.sqrt(1 - y * y) * radius }
}

// Hubs keep a large shared tag linear in edge count, rather than connecting
// every pair of notes. Positions are stable across refreshes of the same data.
export function buildKnowledgeGraph(input: MapNote[], showGroups = true, showTags = true): KnowledgeGraph {
  const notes = [...new Map(input.map(note => [note.id, note])).values()].slice(0, KNOWLEDGE_MAP_LIMIT).sort((a, b) => a.id.localeCompare(b.id))
  const hubs = new Map<string, MapNode>()
  const edges: MapEdge[] = []
  const nodes: MapNode[] = notes.map(note => ({ id: `note:${note.id}`, kind: 'note', label: note.title, note, members: [], x: 0, y: 0, z: 0 }))
  for (const node of nodes) {
    const note = node.note!
    const add = (id: string, kind: 'group' | 'tag', label: string) => {
      if (!hubs.has(id)) hubs.set(id, { id, kind, label, members: [], x: 0, y: 0, z: 0 })
      hubs.get(id)!.members.push(node.id)
      edges.push({ source: node.id, target: id, kind })
    }
    if (showGroups && note.groupId) add(`group:${note.groupId}`, 'group', note.groupName ?? '')
    if (showTags) for (const tag of normalizedMapTags(note.tags)) add(`tag:${tag}`, 'tag', tag)
  }
  const orderedHubs = [...hubs.values()].sort((a, b) => a.id.localeCompare(b.id))
  const radius = 110 + Math.sqrt(notes.length) * 13
  orderedHubs.forEach((hub, index) => Object.assign(hub, sphere(index, orderedHubs.length, radius)))
  const targets = new Map<string, MapNode[]>()
  for (const edge of edges) targets.set(edge.source, [...(targets.get(edge.source) ?? []), hubs.get(edge.target)!])
  nodes.forEach((node, index) => {
    const connected = targets.get(node.id) ?? []
    const base = connected.length ? connected.reduce((sum, hub) => ({ x: sum.x + hub.x / connected.length, y: sum.y + hub.y / connected.length, z: sum.z + hub.z / connected.length }), { x: 0, y: 0, z: 0 }) : sphere(index, nodes.length, radius)
    const seed = hash(node.id)
    const offset = sphere(seed % 997, 997, 35 + seed % 40)
    Object.assign(node, { x: base.x + offset.x, y: base.y + offset.y, z: base.z + offset.z })
  })
  // A short deterministic relaxation separates crowded notes in all 3 axes.
  // This runs only when data/filters change, never in the rendering loop.
  for (let step = 0; step < 24; step++) {
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j]
      const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
      const distance = Math.max(1, Math.hypot(dx, dy, dz))
      if (distance > 70) continue
      const strength = (70 - distance) * 0.035 / distance
      a.x += dx * strength; a.y += dy * strength; a.z += dz * strength
      b.x -= dx * strength; b.y -= dy * strength; b.z -= dz * strength
    }
  }
  return { nodes: [...nodes, ...orderedHubs], edges }
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
