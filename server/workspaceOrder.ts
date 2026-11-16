import { generateId, queryAll, queryOne, run } from './db'
import { LOCAL_PROFILE_ID } from './localProfile'

export type WorkspaceRow = {
  id: string; user_id: string; name: string; is_default: boolean; created_at: number; sort_order: number
}

export function ensureDefaultWorkspace(user = LOCAL_PROFILE_ID) {
  if (queryOne('SELECT id FROM workspaces WHERE user_id = ? AND is_default = 1', [user])) return
  run('INSERT INTO workspaces (id, user_id, name, is_default, sort_order) VALUES (?, ?, ?, 1, ?)',
    [generateId(), user, '공통', nextWorkspacePosition(user)])
}

export function nextWorkspacePosition(user = LOCAL_PROFILE_ID) {
  return queryOne<{ position: number }>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS position FROM workspaces WHERE user_id = ?', [user])!.position
}

export function orderedWorkspaces(user = LOCAL_PROFILE_ID): WorkspaceRow[] {
  return queryAll<WorkspaceRow>('SELECT * FROM workspaces WHERE user_id = ? ORDER BY sort_order ASC, is_default DESC, created_at ASC, id ASC', [user])
    .map(row => ({ ...row, is_default: !!row.is_default }))
}
