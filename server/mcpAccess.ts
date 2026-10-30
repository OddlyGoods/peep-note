import fs from 'node:fs'
import path from 'node:path'
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'

// Separate from provider credentials and never exposed through MCP tools.
export function createMcpAccess(directory?: string) {
  const file = directory ? path.join(directory, 'mcp-access.json') : null
  let state: { enabled: boolean; token: string } = { enabled: false, token: '' }
  if (file && fs.existsSync(file)) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (saved.enabled === true && typeof saved.token === 'string' && /^[a-f0-9]{64}$/.test(saved.token)) state = saved
    } catch { /* An unreadable configuration fails closed. */ }
  }
  return {
    get enabled() { return state.enabled },
    setEnabled(enabled: boolean) {
      if (enabled === state.enabled) return
      const next = { enabled, token: enabled ? randomBytes(32).toString('hex') : '' }
      if (file) {
        const temporary = `${file}.tmp`
        fs.writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 })
        fs.chmodSync(temporary, 0o600)
        fs.renameSync(temporary, file)
      }
      state = next
    },
    accepts(header: string | undefined) {
      if (!state.enabled || !header) return false
      const digest = (value: string) => createHash('sha256').update(value).digest()
      return timingSafeEqual(digest(header), digest(`Bearer ${state.token}`))
    },
    codexConfig(endpoint: string) {
      if (!state.enabled) throw new Error('MCP_DISABLED')
      return `[mcp_servers.peepnote]\nurl = ${JSON.stringify(endpoint)}\nhttp_headers = { Authorization = ${JSON.stringify(`Bearer ${state.token}`)} }\n`
    }
  }
}

export type McpAccess = ReturnType<typeof createMcpAccess>
