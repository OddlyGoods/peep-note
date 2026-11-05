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
const qa = (window as any).qa = { requests: [] as string[], fail: false, empty: false }
const titles = ['RAG pipeline overview', 'Chunking strategies', 'Embedding model comparison', 'Retrieval quality checklist', 'Hybrid search experiments', 'Reranking with cross encoders', 'Prompt templates', 'Evaluation datasets', 'Vector database notes', 'Reducing hallucinations', 'Product launch checklist', 'Customer interview notes', 'Release plan', 'Landing page draft', 'API design decisions', 'Database migration plan', 'Authentication flow', 'Performance profiling', 'Canvas rendering notes', 'Desktop keyboard shortcuts', 'Research reading list', 'Semantic caching', 'Context window budgets', 'Cost tracking']
qa.notes = titles.map((title, index) => ({ id: `fixture-${index}`, title, excerpt: `# ${title}\n\nPractical notes and findings for our next iteration.\n\nKeep the source, compare approaches, and record the result.`, tags: [index < 10 ? 'rag' : index < 14 ? 'product' : 'engineering', ['research', 'performance', 'design'][index % 3]], groupId: index < 20 ? `g-${Math.floor(index / 5)}` : null, groupName: ['RAG research', 'Search quality', 'Product launch', 'Desktop development'][Math.floor(index / 5)] ?? null, workspaceId: index < 14 ? 'general' : 'engineering', workspaceName: index < 14 ? 'General' : 'Engineering', workspaceDefault: index < 14, type: 'note', createdAt: 1700000000 + index }))
window.fetch = (async (input: any) => {
  const url = new URL(String(input)), route = url.pathname
  qa.requests.push(route)
  if (route === '/api/knowledge-map') {
    if (qa.fail) return Response.json({ error: 'Fixture failure' }, { status: 503 })
    const workspace = url.searchParams.get('workspace'), search = (url.searchParams.get('search') || '').toLowerCase()
    const notes = qa.empty ? [] : qa.notes.filter((note: any) => (!workspace || note.workspaceId === workspace) && JSON.stringify(note).toLowerCase().includes(search))
    return Response.json({ notes, total: notes.length, limit: 400 })
  }
  if (route === '/api/workspaces') return Response.json([{ id: 'general', name: 'General', is_default: true }, { id: 'engineering', name: 'Engineering', is_default: false }])
  if (route.endsWith('/count')) return Response.json({ count: 0 })
  if (route === '/api/mcp') return Response.json({ enabled: false })
  if (route.endsWith('/comments')) return Response.json([])
  if (route.startsWith('/api/logs/')) {
    const note = qa.notes.find((item: any) => item.id === route.split('/').pop())
    return Response.json({ ...note, content: note?.excerpt ?? '', log_type: 'note', content_format: 'markdown', attachments: [], pinned: false, favorite: false, is_secret: false, created_at: 1700000000, updated_at: 1700000000, workspace_id: note?.workspaceId, group_id: null })
  }
  if (route === '/api/logs' || route === '/api/groups') return Response.json([])
  throw new Error('Unexpected map fixture request: ' + route)
}) as typeof fetch

function Harness() {
  const { setTheme } = useTheme(), { setLanguage } = useI18n(), navigate = useNavigate(), location = useLocation()
  qa.theme = setTheme; qa.language = setLanguage; qa.navigate = navigate; qa.path = location.pathname
  qa.refresh = () => useLogStore.setState({ logs: [] })
  qa.point = (id: string) => {
    const graph = buildKnowledgeGraph(qa.notes), node = graph.nodes.find(item => item.id === id)!
    const rect = document.querySelector('canvas')!.getBoundingClientRect()
    const extent = Math.max(160, ...graph.nodes.map(item => Math.hypot(item.x, item.y, item.z)))
    const point = projectMapNode(node, INITIAL_MAP_CAMERA, rect.width, rect.height, extent)
    return { x: point.x + rect.x, y: point.y + rect.y }
  }
  useEffect(() => { qa.ready = true }, [])
  return <Layout><ScreenCache screens={[
    { key: 'knowledge-map', path: '/map', element: <KnowledgeMap /> },
    { key: 'map-detail', path: '/map/log/:id', element: <LogDetail /> },
    { key: 'settings', path: '/settings', element: <div>Fixture settings</div> },
  ]} /></Layout>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><ThemeProvider><I18nProvider><MemoryRouter initialEntries={['/map']}><LogNavigationProvider><Harness /></LogNavigationProvider></MemoryRouter></I18nProvider></ThemeProvider></React.StrictMode>)
