import fs from 'node:fs'
import path from 'node:path'
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import type { McpClient } from '../shared/mcpClients'

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
  function clientConfig(endpoint: string, client: McpClient = 'codex') {
    if (!state.enabled) throw new Error('MCP_DISABLED')
    const authorization = `Bearer ${state.token}`
    if (client === 'claude-code') {
      return `claude mcp add --transport http --scope user peepnote ${JSON.stringify(endpoint)} --header ${JSON.stringify(`Authorization: ${authorization}`)}`
    }
    if (client === 'gemini-cli') {
      return `gemini mcp add --transport http --scope user --header ${JSON.stringify(`Authorization: ${authorization}`)} peepnote ${JSON.stringify(endpoint)}`
    }
    return `[mcp_servers.peepnote]\nurl = ${JSON.stringify(endpoint)}\nhttp_headers = { Authorization = ${JSON.stringify(authorization)} }\n`
  }
  return {
    clientConfig,
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
      return clientConfig(endpoint)
    }
  }
}

export type McpAccess = ReturnType<typeof createMcpAccess>
