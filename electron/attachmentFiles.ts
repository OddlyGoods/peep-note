import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { attachmentMimeType, attachmentReference, isImageAttachment, type ImportedAttachment } from '../shared/attachments'

export async function importLocalAttachments(entries: unknown, mode: unknown, directory: string): Promise<ImportedAttachment[]> {
  if (!Array.isArray(entries) || (mode !== 'copy' && mode !== 'link')) return []
  const imported: ImportedAttachment[] = []
  for (const entry of entries.slice(0, 100)) {
    if (!entry || typeof entry.path !== 'string' || !path.isAbsolute(entry.path)) continue
    const source = path.resolve(entry.path)
    const name = path.basename(source)
    let container = ''
    try {
      const stat = await fs.stat(source)
      if (!stat.isFile()) continue
      let destination = source
      if (mode === 'copy') {
        container = path.join(directory, randomUUID())
        await fs.mkdir(container, { recursive: true })
        const safeName = name.replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(-120) || 'file'
        destination = path.join(container, safeName)
        await fs.copyFile(source, destination)
      }
      imported.push({ path: attachmentReference(destination, mode), name, size: stat.size, isImage: isImageAttachment(name), mimeType: attachmentMimeType(name) })
    } catch {
      if (container) await fs.rm(container, { recursive: true, force: true }).catch(() => {})
    }
  }
  return imported
}
