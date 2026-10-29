import fs from 'node:fs/promises'
import path from 'node:path'

export async function directoryUsage(directory: string): Promise<{ bytes: number; partial: boolean }> {
  const pending = [directory]
  let bytes = 0
  let partial = false
  while (pending.length) {
    const current = pending.pop()!
    try {
      const entries = await fs.readdir(current, { withFileTypes: true })
      for (const entry of entries) {
        const file = path.join(current, entry.name)
        try {
          // Do not follow symbolic links or count files outside the data folder.
          const stat = await fs.lstat(file)
          if (stat.isDirectory()) pending.push(file)
          else if (stat.isFile()) bytes += stat.size
        } catch { partial = true }
      }
    } catch { partial = true }
  }
  return { bytes, partial }
}
