import fs from 'fs'
import path from 'path'
import { generateId, queryOne, run } from './db'
import { LOCAL_PROFILE_ID } from './localProfile'
import { captureNoteMarkdown, captureAnalysisCopy, type CaptureLanguage, type CaptureTurn } from '../shared/captureAnalysis'

export function saveCaptureAnalysis(turns: CaptureTurn[], images: string[], screenshotsDir: string, language: CaptureLanguage, workspaceId: string | null) {
  if (!turns.length || turns.some(turn => !turn.answer.trim())) throw new Error('No completed response')
  const copies: string[] = []
  try {
    fs.mkdirSync(screenshotsDir, { recursive: true })
    for (const image of images) {
      const destination = path.join(screenshotsDir, `capture_${generateId()}.png`)
      fs.copyFileSync(image, destination)
      copies.push(destination)
    }
    const workspace = workspaceId && queryOne<{ id: string }>('SELECT id FROM workspaces WHERE id = ? AND user_id = ?', [workspaceId, LOCAL_PROFILE_ID])
    const defaultWorkspace = queryOne<{ id: string }>('SELECT id FROM workspaces WHERE user_id = ? AND is_default = 1 LIMIT 1', [LOCAL_PROFILE_ID])
    const id = generateId(), now = Math.floor(Date.now() / 1000)
    const firstLine = turns[0].title?.trim().slice(0, 100) || turns[0].answer.split('\n').find(line => line.trim())?.replace(/^[#>*\s]+/, '').replace(/[*`]/g, '').slice(0, 100)
    run(`INSERT INTO logs (id, user_id, title, content, log_type, content_format, tags, attachments, workspace_id, is_secret, created_at, updated_at, ocr_status)
      VALUES (?, ?, ?, ?, 'note', 'markdown', '[]', ?, ?, 0, ?, ?, 'idle')`,
    [id, LOCAL_PROFILE_ID, firstLine || captureAnalysisCopy[language].noteTitle, captureNoteMarkdown(turns), JSON.stringify(copies), workspace ? workspace.id : defaultWorkspace?.id ?? null, now, now])
    return id
  } catch (error) {
    for (const file of copies) { try { fs.unlinkSync(file) } catch {} }
    throw error
  }
}
