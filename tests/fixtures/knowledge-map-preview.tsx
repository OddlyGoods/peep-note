import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { I18nProvider, useI18n } from '../../src/i18n'
import { ThemeProvider, useTheme } from '../../src/theme'
import Layout from '../../src/components/Layout'
import ScreenCache from '../../src/components/ScreenCache'
import LogNavigationProvider from '../../src/components/LogNavigationProvider'
import KnowledgeMap from '../../src/pages/KnowledgeMap'
import LogDetail from '../../src/pages/LogDetail'
import { buildKnowledgeGraph, INITIAL_MAP_CAMERA, projectMapNode } from '../../shared/knowledgeMap'
import { useLogStore } from '../../src/stores/logStore'

localStorage.clear()
const qa = (window as any).qa = { requests: [] as string[], fail: false, empty: false, enabled: false }
const titles = ['RAG pipeline overview', 'Chunking strategies', 'Embedding model comparison', 'Retrieval quality checklist', 'Hybrid search experiments', 'Reranking with cross encoders', 'Prompt templates', 'Evaluation datasets', 'Vector database notes', 'Reducing hallucinations', 'Product launch checklist', 'Customer interview notes', 'Release plan', 'Landing page draft', 'API design decisions', 'Database migration plan', 'Authentication flow', 'Performance profiling', 'Canvas rendering notes', 'Desktop keyboard shortcuts', 'Research reading list', 'Semantic caching', 'Context window budgets', 'Cost tracking']
qa.notes = titles.map((title, index) => ({ id: `fixture-${index}`, title, excerpt: `# ${title}\n\nPractical notes and findings for our next iteration.`, workspaceId: index < 14 ? 'general' : 'engineering', workspaceName: index < 14 ? 'General' : 'Engineering', workspaceDefault: index < 14, type: 'note', createdAt: 1700000000 + index }))
qa.connections = [{ source: 'fixture-0', target: 'fixture-1', similarity: .94 }, { source: 'fixture-0', target: 'fixture-2', similarity: .9 }, { source: 'fixture-1', target: 'fixture-2', similarity: .88 }, { source: 'fixture-14', target: 'fixture-15', similarity: .89 }]
qa.indexing = { stage: 'ready', total: 24, completed: 24 }
window.fetch = (async (input: any, init?: RequestInit) => {
  const url = new URL(String(input)), route = url.pathname
  qa.requests.push(route)
  if (route === '/api/knowledge-map/enabled') { qa.enabled = JSON.parse(String(init?.body)).enabled; return Response.json({ enabled: qa.enabled }) }
  if (route === '/api/knowledge-map/retry') { qa.indexing = { stage: 'ready', total: 24, completed: 24 }; return Response.json({ ok: true }) }
  if (route === '/api/knowledge-map') {
    if (!qa.enabled) return Response.json({ enabled: false, notes: [], connections: [], indexing: { stage: 'idle', total: 0, completed: 0 }, total: 0, limit: 400 })
    if (qa.fail) return Response.json({ error: 'Fixture failure' }, { status: 503 })
    const workspace = url.searchParams.get('workspace'), search = (url.searchParams.get('search') || '').toLowerCase()
    const notes = qa.empty ? [] : qa.notes.filter((note: any) => (!workspace || note.workspaceId === workspace) && JSON.stringify(note).toLowerCase().includes(search))
    const ids = new Set(notes.map((note: any) => note.id))
    return Response.json({ enabled: true, notes: notes.map(({ excerpt, ...note }: any) => note), connections: qa.connections.filter((edge: any) => ids.has(edge.source) && ids.has(edge.target)), indexing: qa.indexing, total: notes.length, limit: 400 })
  }
  if (route === '/api/workspaces') return Response.json([{ id: 'general', name: 'General', is_default: true }, { id: 'engineering', name: 'Engineering', is_default: false }])
  if (route.endsWith('/count')) return Response.json({ count: 0 })
  if (route === '/api/mcp') return Response.json({ enabled: false })
  if (route.endsWith('/comments')) return Response.json([])
  if (route.startsWith('/api/logs/')) {
    const note = qa.notes.find((item: any) => item.id === route.split('/').pop())
    return Response.json({ ...note, content: (note?.excerpt ?? '') + '\n\n' + 'Full body detail. '.repeat(70) + 'End of full note', log_type: 'note', content_format: 'markdown', tags: [], attachments: [], pinned: false, favorite: false, is_secret: false, created_at: 1700000000, updated_at: 1700000000, workspace_id: note?.workspaceId, group_id: null })
  }
  if (route === '/api/logs' || route === '/api/groups') return Response.json([])
  throw new Error('Unexpected map fixture request: ' + route)
}) as typeof fetch

function Harness() {
  const { setTheme } = useTheme(), { setLanguage } = useI18n(), navigate = useNavigate(), location = useLocation()
  qa.theme = setTheme; qa.language = setLanguage; qa.navigate = navigate; qa.path = location.pathname
  qa.refresh = () => useLogStore.setState({ logs: [] })
  qa.point = (id: string) => {
    const graph = buildKnowledgeGraph(qa.notes, qa.connections), node = graph.nodes.find(item => item.id === id)!
    const rect = document.querySelector('canvas')!.getBoundingClientRect()
    const extent = Math.max(160, ...graph.nodes.map(item => Math.hypot(item.x, item.y, item.z)))
    const point = projectMapNode(node, INITIAL_MAP_CAMERA, rect.width, rect.height, extent)
    return { x: point.x + rect.x, y: point.y + rect.y }
  }
  useEffect(() => { qa.ready = true }, [])
  return <Layout><ScreenCache screens={[
    { key: 'knowledge-map', path: '/map', element: <KnowledgeMap /> },
    { key: 'explore-detail', path: '/log/:id', element: <LogDetail /> },
    { key: 'explore-list', path: '/', element: <div>Fixture Explore list</div> },
    { key: 'settings', path: '/settings', element: <div>Fixture settings</div> },
  ]} /></Layout>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><ThemeProvider><I18nProvider><MemoryRouter initialEntries={['/map']}><LogNavigationProvider><Harness /></LogNavigationProvider></MemoryRouter></I18nProvider></ThemeProvider></React.StrictMode>)
