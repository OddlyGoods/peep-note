import assert from 'node:assert/strict'
import test from 'node:test'
import { buildKnowledgeGraph, INITIAL_MAP_CAMERA, KNOWLEDGE_MAP_LIMIT, projectMapNode, type MapNote } from '../shared/knowledgeMap'
import { semanticConnections, normalizedVector } from '../shared/localEmbeddings'
const note = (id: string): MapNote => ({ id, title: id, workspaceId: 'general', workspaceName: 'General', workspaceDefault: true, type: 'note', createdAt: 1 })

test('semantic graph connects notes directly and never creates group or tag hubs', () => {
  const graph = buildKnowledgeGraph([note('a'), note('b'), note('isolated')], [{ source: 'a', target: 'b', similarity: .94 }, { source: 'b', target: 'a', similarity: .94 }, { source: 'a', target: 'missing', similarity: 1 }, { source: 'a', target: 'a', similarity: 1 }])
  assert.equal(graph.nodes.length, 3); assert.ok(graph.nodes.every(node => node.kind === 'note'))
  assert.deepEqual(graph.edges, [{ source: 'note:a', target: 'note:b', similarity: .94 }])
  assert.ok(graph.nodes.some(node => node.id === 'note:isolated'))
})
test('semantic layout is deterministic and similar notes move closer without inventing edges', () => {
  const notes = Array.from({ length: 20 }, (_, i) => note(String(i)))
  const edge = [{ source: '0', target: '19', similarity: .95 }]
  const graph = buildKnowledgeGraph(notes, edge)
  assert.deepEqual(graph, buildKnowledgeGraph([...notes].reverse(), edge))
  const disconnected = buildKnowledgeGraph(notes)
  const distance = (g: typeof graph) => { const a = g.nodes[0], b = g.nodes.find(node => node.id === 'note:19')!; return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) }
  assert.ok(distance(graph) < distance(disconnected))
  assert.equal(disconnected.edges.length, 0)
  for (const node of graph.nodes) assert.ok([node.x, node.y, node.z].every(Number.isFinite))
  assert.equal(buildKnowledgeGraph(Array.from({ length: 1000 }, (_, i) => note(String(i)))).nodes.length, KNOWLEDGE_MAP_LIMIT)
})
test('mutual semantic neighbours exclude unrelated notes and bound the degree', () => {
  const vectors = new Map([['a', normalizedVector([1, .1, 0])!], ['b', normalizedVector([1, .12, 0])!], ['c', [0, 0, 1]], ['d', [-1, 0, 0]]])
  const edges = semanticConnections(vectors)
  assert.equal(edges.length, 1); assert.equal(edges[0].source, 'a'); assert.equal(edges[0].target, 'b')
  assert.ok(edges[0].similarity > .99)
  const many = semanticConnections(new Map(Array.from({ length: 20 }, (_, i) => [String(i), normalizedVector([1, i / 100, .1])!])))
  assert.ok(many.length > 0, 'a collection of related notes must retain connections even when its median similarity is high')
  for (let i = 0; i < 20; i++) assert.ok(many.filter(edge => edge.source === String(i) || edge.target === String(i)).length <= 3)
  assert.equal(normalizedVector([0, 0]), null); assert.equal(normalizedVector([NaN]), null)
})
test('camera rotation, pan and zoom change perspective without mutating coordinates', () => {
  const point = { x: 100, y: 50, z: 100 }, camera = { ...INITIAL_MAP_CAMERA }
  const first = projectMapNode(point, camera, 800, 600, 200)
  const turned = projectMapNode(point, { ...camera, yaw: camera.yaw + 1 }, 800, 600, 200)
  assert.notEqual(first.x, turned.x); assert.notEqual(first.z, turned.z)
  const panned = projectMapNode(point, { ...camera, panX: 40, panY: 20 }, 800, 600, 200)
  assert.equal(panned.x, first.x + 40); assert.equal(panned.y, first.y + 20)
  assert.equal(projectMapNode(point, { ...camera, zoom: 2 }, 800, 600, 200).x - 400, (first.x - 400) * 2)
  assert.deepEqual(point, { x: 100, y: 50, z: 100 })
})
