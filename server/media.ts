import fs from 'fs'
import path from 'path'
import { getUserDataPath, queryAll } from './db'
import { attachmentPath, isLinkedAttachment, isImageAttachment } from '../shared/attachments'

export function mediaPaths(row: { file_path?: string | null; attachments?: string }): string[] {
  let attachments: unknown = []
  try { attachments = JSON.parse(row.attachments || '[]') } catch {}
  return [row.file_path, ...(Array.isArray(attachments) ? attachments : [])]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
}

export function imageMediaPaths(row: { file_path?: string | null; attachments?: string }): string[] {
  return mediaPaths(row).filter(isImageAttachment)
}

// Only app-managed copies can be removed by attachment or trash cleanup.
export function managedMediaPath(filePath: string): string | null {
  if (isLinkedAttachment(filePath)) return null
  try {
    const resolved = fs.realpathSync(filePath)
    const roots = ['screenshots', 'videos', 'attachments'].map(dir => path.resolve(getUserDataPath(), dir))
    return roots.some(root => {
      const relative = path.relative(root, resolved)
      return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
    }) ? resolved : null
  } catch { return null }
}

export function readableMediaPath(reference: string): string | null {
  if (!isLinkedAttachment(reference)) return managedMediaPath(reference)
  if (!path.isAbsolute(attachmentPath(reference))) return null
  try {
    const resolved = fs.realpathSync(attachmentPath(reference))
    return fs.statSync(resolved).isFile() ? resolved : null
  } catch { return null }
}

export function cleanupUnreferencedMedia(filePaths: string[]) {
  if (!filePaths.length) return
  const references = new Set(queryAll<{ file_path: string | null; attachments: string }>('SELECT file_path, attachments FROM logs')
    .flatMap(mediaPaths)
    .map(file => managedMediaPath(attachmentPath(file)))
    .filter((file): file is string => !!file))
  for (const filePath of new Set(filePaths)) {
    const resolved = managedMediaPath(filePath)
    if (resolved && !references.has(resolved)) {
      try {
        fs.unlinkSync(resolved)
        const parent = path.dirname(resolved)
        if (path.dirname(parent) === path.resolve(getUserDataPath(), 'attachments')) {
          try { fs.rmdirSync(parent) } catch {}
        }
      } catch (error) { console.warn('Detached media cleanup failed:', error) }
    }
  }
}
