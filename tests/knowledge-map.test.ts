import assert from 'node:assert/strict'
import test from 'node:test'
import { buildKnowledgeGraph, INITIAL_MAP_CAMERA, KNOWLEDGE_MAP_LIMIT, normalizedMapTags, projectMapNode, type MapNote } from '../shared/knowledgeMap'

const note = (id: string, overrides: Partial<MapNote> = {}): MapNote => ({ id, title: id, excerpt: '', tags: [], groupId: null, groupName: null, workspaceId: 'general', workspaceName: 'General', workspaceDefault: true, type: 'note', createdAt: 1, ...overrides })
test('map joins groups by identity and tags across workspaces without duplicate edges', () => {
  const graph = buildKnowledgeGraph([
    note('a', { groupId: 'g1', groupName: 'Research', tags: ['RAG', ' #rag ', 'Vision'] }),
    note('b', { groupId: 'g1', groupName: 'Research', workspaceId: 'other', tags: ['rag'] }),
    note('c', { groupId: 'g2', groupName: 'Research' }), note('isolated'),
  ])
  assert.equal(graph.nodes.filter(node => node.kind === 'group').length, 2, 'same names do not merge different groups')
  assert.deepEqual(graph.nodes.find(node => node.id === 'tag:rag')?.members, ['note:a', 'note:b'])
  assert.equal(new Set(graph.edges.map(edge => edge.source + edge.target)).size, graph.edges.length)
  assert.ok(graph.nodes.some(node => node.id === 'note:isolated'))
  for (const edge of graph.edges) { assert.notEqual(edge.source, edge.target); assert.ok(graph.nodes.some(node => node.id === edge.target)) }
})
test('map positions are deterministic, finite, three dimensional, and filters remove only their hubs/edges', () => {
  const notes = Array.from({ length: 40 }, (_, i) => note(String(i), { groupId: `group${i % 4}`, tags: [`tag${i % 3}`] }))
  const graph = buildKnowledgeGraph(notes)
  assert.deepEqual(graph, buildKnowledgeGraph([...notes].reverse()))
  assert.ok(new Set(graph.nodes.map(node => node.z)).size > 10)
  for (const node of graph.nodes) assert.ok([node.x, node.y, node.z].every(Number.isFinite))
  const tagsOnly = buildKnowledgeGraph(notes, false, true)
  assert.ok(tagsOnly.edges.every(edge => edge.kind === 'tag'))
  const notesOnly = buildKnowledgeGraph(notes, false, false)
  assert.equal(notesOnly.edges.length, 0); assert.equal(notesOnly.nodes.length, notes.length)
  assert.deepEqual(buildKnowledgeGraph([]), { nodes: [], edges: [] })
})
test('large maps use bounded note counts and linear edges for a shared tag', () => {
  const graph = buildKnowledgeGraph(Array.from({ length: 1000 }, (_, i) => note(String(i), { tags: ['shared'] })))
  assert.equal(graph.nodes.length, KNOWLEDGE_MAP_LIMIT + 1)
  assert.equal(graph.edges.length, KNOWLEDGE_MAP_LIMIT)
  assert.deepEqual(normalizedMapTags([null, 5, '', '#RAG', 'rag', 'ＡＩ']), ['rag', 'ai'])
  const manyTags = Array.from({ length: 25 }, (_, index) => `tag-${index}`)
  assert.equal(buildKnowledgeGraph([note('many-tags', { tags: manyTags })]).edges.length, 25, 'all tags on a visible note remain connected')
})
test('camera rotation, pan and zoom change perspective without mutating the graph', () => {
  const point = { x: 100, y: 50, z: 100 }, camera = { ...INITIAL_MAP_CAMERA }
  const first = projectMapNode(point, camera, 800, 600, 200)
  const turned = projectMapNode(point, { ...camera, yaw: camera.yaw + 1 }, 800, 600, 200)
  assert.notEqual(first.x, turned.x); assert.notEqual(first.z, turned.z)
  const panned = projectMapNode(point, { ...camera, panX: 40, panY: 20 }, 800, 600, 200)
  assert.equal(panned.x, first.x + 40); assert.equal(panned.y, first.y + 20)
  assert.equal(projectMapNode(point, { ...camera, zoom: 2 }, 800, 600, 200).x - 400, (first.x - 400) * 2)
  assert.deepEqual(point, { x: 100, y: 50, z: 100 })
})
