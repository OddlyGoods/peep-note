import { invalidateExploreCache } from './exploreCache'
import type { TrashRetentionDays } from '../../shared/trashRetention'
import type { Hotkeys } from '../../shared/hotkeys'
import type { AiConnectionInput, AiConnectionResult } from '../../shared/aiConnection'
import type { AiModelMap, AiProvider } from '../../shared/aiModels'

const configuredPort = Number(import.meta.env.VITE_LOCAL_SERVER_PORT)
const LOCAL_SERVER_PORT = Number.isInteger(configuredPort) && configuredPort >= 1024 && configuredPort <= 65535 ? configuredPort : 3848
const BASE = `http://127.0.0.1:${LOCAL_SERVER_PORT}`
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {})
    }
  })
  const data = await res.json()
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'Request failed'), { status: res.status })
  if (options.method && options.method !== 'GET' && /^\/api\/(logs|groups|trash|workspaces)(?:\/|$|\?)/.test(path)) invalidateExploreCache()
  return data as T
}

export const api = {
  // Logs
  logs: {
    favoriteCount: () => request<{ count: number }>('/api/logs/favorites/count'),
    deleteOcr: (id: string) => request(`/api/logs/${id}/ocr`, { method: 'DELETE' }),
    ocrStatus: () => request<Record<string, number>>('/api/logs/ocr-status'),
    extractText: (id: string) => request(`/api/logs/${id}/ocr`, { method: 'POST' }),
    list: (params?: { date?: string; date_from?: string; date_to?: string; type?: string; search?: string; workspace_id?: string; page?: number; limit?: number; sort?: 'recent'; favorite?: boolean }) => {
      const q = new URLSearchParams()
      if (params?.favorite) q.set('favorite', 'true')
      if (params?.date) q.set('date', params.date)
      if (params?.date_from) q.set('date_from', params.date_from)
      if (params?.date_to) q.set('date_to', params.date_to)
      if (params?.type) q.set('type', params.type)
      if (params?.search) q.set('search', params.search)
      if (params?.workspace_id) q.set('workspace_id', params.workspace_id)
      if (params?.page) q.set('page', String(params.page))
      if (params?.limit) q.set('limit', String(params.limit))
      if (params?.sort) q.set('sort', params.sort)
      return request<Log[]>(`/api/logs?${q}`)
    },
    get: (id: string) => request<Log>(`/api/logs/${id}`),
    create: (data: Partial<Log>) =>
      request<Log>('/api/logs', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Log>) =>
      request<Log>(`/api/logs/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    move: (id: string, workspace_id: string) =>
      request<Log>(`/api/logs/${id}/move`, { method: 'POST', body: JSON.stringify({ workspace_id }) }),
    delete: (id: string) =>
      request(`/api/logs/${id}`, { method: 'DELETE' }),
    bulkDelete: (ids: string[]) =>
      request<{ ok: boolean; deleted: number }>('/api/logs/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) }),
    bulkMove: (log_ids: string[], group_ids: string[], workspace_id: string) =>
      request<{ ok: boolean; logs: number; groups: number }>('/api/logs/bulk-move', { method: 'POST', body: JSON.stringify({ log_ids, group_ids, workspace_id }) }),
    comments: (id: string) => request<LogComment[]>(`/api/logs/${id}/comments`),
    addComment: (id: string, content: string, attachments: string[] = []) =>
      request<LogComment & { comment_count: number }>(`/api/logs/${id}/comments`, { method: 'POST', body: JSON.stringify({ content, attachments }) }),
    updateComment: (id: string, commentId: string, content: string, attachments?: string[]) =>
      request<LogComment & { comment_count: number }>(`/api/logs/${id}/comments/${commentId}`, { method: 'PUT', body: JSON.stringify({ content, attachments }) }),
    updateCommentFiles: (id: string, commentId: string, attachments: string[]) =>
      request<LogComment & { comment_count: number }>(`/api/logs/${id}/comments/${commentId}`, { method: 'PUT', body: JSON.stringify({ attachments }) }),
    deleteComment: (id: string, commentId: string) =>
      request<{ ok: boolean; comment_count: number }>(`/api/logs/${id}/comments/${commentId}`, { method: 'DELETE' }),
    statsDates: () =>
      request<{ date: string; count: number }[]>('/api/logs/stats/dates'),
    statsTypes: (params?: { date_from?: string; date_to?: string; workspace_id?: string }) => {
      const q = new URLSearchParams()
      if (params?.date_from) q.set('date_from', params.date_from)
      if (params?.date_to) q.set('date_to', params.date_to)
      if (params?.workspace_id) q.set('workspace_id', params.workspace_id)
      return request<{ log_type: string; count: number }[]>(`/api/logs/stats/types?${q}`)
    },
    statsWorkspaces: (params?: { date_from?: string; date_to?: string }) => {
      const q = new URLSearchParams()
      if (params?.date_from) q.set('date_from', params.date_from)
      if (params?.date_to) q.set('date_to', params.date_to)
      return request<{ workspace_id: string | null; count: number }[]>(`/api/logs/stats/workspaces?${q}`)
    },
    statsTags: (params?: { date_from?: string; date_to?: string; workspace_id?: string }) => {
      const q = new URLSearchParams()
      if (params?.date_from) q.set('date_from', params.date_from)
      if (params?.date_to) q.set('date_to', params.date_to)
      if (params?.workspace_id) q.set('workspace_id', params.workspace_id)
      return request<{ tag: string; count: number }[]>(`/api/logs/stats/tags?${q}`)
    }
  },

  trash: {
    retention: () => request<{ days: TrashRetentionDays }>('/api/trash/retention'),
    count: () => request<{ count: number }>('/api/trash/count'),
    list: () => request<TrashItem[]>('/api/trash'),
    restore: (ids: string[]) => request<{ restored: number }>('/api/trash/restore', { method: 'POST', body: JSON.stringify({ ids }) }),
    purge: (ids: string[]) => request<{ deleted: number }>('/api/trash/purge', { method: 'POST', body: JSON.stringify({ ids }) }),
    empty: () => request<{ deleted: number }>('/api/trash', { method: 'DELETE' })
  },

  // Settings
  settings: {
    get: () => request<Settings>('/api/settings'),
    update: (data: Partial<Settings>) =>
      request<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(data) }),
    secretPasswordStatus: () => request<{ is_set: boolean }>('/api/settings/secret-password/status'),
    verifySecretPassword: (password: string) => request<{ ok: boolean }>('/api/settings/secret-password/verify', { method: 'POST', body: JSON.stringify({ password }) }),
    setSecretPassword: (password: string, current_password?: string) => request<{ ok: boolean }>('/api/settings/secret-password', { method: 'PUT', body: JSON.stringify({ password, current_password }) })
  },

  // AI
  ai: {
    testConnection: (input: AiConnectionInput, signal?: AbortSignal) => request<AiConnectionResult>('/api/ai/test-connection', {
      method: 'POST', body: JSON.stringify(input), signal
    }),
    keyStatus: () => request<{ has_key: boolean; provider: string }>('/api/ai/key-status'),
    summarize: (group_id: string, language?: Settings['language']) =>
      request<{ ok: boolean; summary: string }>('/api/ai/summarize', {
        method: 'POST', body: JSON.stringify({ group_id, language })
      })
  },

  // Groups
  groups: {
    list: (params?: { date?: string; date_from?: string; date_to?: string; workspace_id?: string; type?: string; search?: string }) => {
      const q = new URLSearchParams()
      if (params?.date) q.set('date', params.date)
      if (params?.date_from) q.set('date_from', params.date_from)
      if (params?.date_to) q.set('date_to', params.date_to)
      if (params?.workspace_id) q.set('workspace_id', params.workspace_id)
      if (params?.type) q.set('type', params.type)
      if (params?.search) q.set('search', params.search)
      return request<LogGroup[]>(`/api/groups?${q}`)
    },
    create: (name: string, log_ids: string[], workspace_id?: string | null, language?: 'en' | 'ko' | 'ja' | 'zh') =>
      request<LogGroup>('/api/groups', { method: 'POST', body: JSON.stringify({ name, log_ids, workspace_id, language }) }),
    rename: (id: string, name: string) =>
      request<LogGroup>(`/api/groups/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
    ungroup: (id: string) =>
      request(`/api/groups/${id}/ungroup`, { method: 'POST' }),
    delete: (id: string) =>
      request(`/api/groups/${id}`, { method: 'DELETE' })
  },

  // Workspaces
  workspaces: {
    list: () => request<Workspace[]>('/api/workspaces'),
    create: (name: string) =>
      request<Workspace>('/api/workspaces', { method: 'POST', body: JSON.stringify({ name }) }),
    update: (id: string, name: string) =>
      request<Workspace>(`/api/workspaces/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
    delete: (id: string) =>
      request(`/api/workspaces/${id}`, { method: 'DELETE' })
  }
}

// Types
export interface TrashItem {
  workspace_name: string | null
  workspace_is_default: boolean
  id: string
  title: string
  log_type: Log['log_type']
  content_format?: Log['content_format']
  is_secret: boolean
  deleted_at: number
  expires_at: number
}

export interface Log {
  ocr_text?: string
  ocr_status?: 'idle' | 'pending' | 'processing' | 'done' | 'error'

  id: string
  user_id: string
  title: string
  content: string
  log_type: 'note' | 'screenshot' | 'video' | 'summary'
  content_format: 'text' | 'markdown' | 'code' | 'html'
  file_path: string | null
  tags: string[]
  attachments: string[]
  favorite?: number
  pinned: number
  is_secret: boolean
  workspace_id: string | null
  group_id: string | null
  group_created_at?: number | null
  summary_provider?: AiProvider | null
  summary_model?: string | null
  summary_duration_ms?: number | null
  created_at: number
  updated_at: number
  comment_count?: number
}

export interface LogComment {
  attachments: string[]
  id: string
  log_id: string
  user_id: string
  content: string
  created_at: number
}

export interface LogGroup {
  id: string
  user_id: string
  name: string
  workspace_id: string | null
  created_at: number
  logs: Log[]
}

export interface Workspace {
  id: string
  user_id: string
  name: string
  is_default: boolean
  created_at: number
}

export interface Settings {
  user_id: string
  hotkeys: Hotkeys
  backup_enabled: boolean
  backup_url: string | null
  theme: string
  ai_provider: 'openai' | 'anthropic' | 'gemini' | 'qwen'
  ai_model: string
  ai_models?: Partial<AiModelMap>
  openai_api_key: string | null
  anthropic_api_key: string | null
  gemini_api_key: string | null
  qwen_api_key: string | null
  qwen_base_url: string | null
  language: 'en' | 'ko' | 'ja' | 'zh'
  auto_advance_date_range: boolean
  fixed_start_date: boolean
  trash_retention_days: TrashRetentionDays
  secret_password_set?: boolean
}
