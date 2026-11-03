export const MCP_CLIENTS = [
  { id: 'codex', label: 'Codex' },
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'gemini-cli', label: 'Gemini CLI' },
  { id: 'qwen-code', label: 'Qwen Code' },
] as const

export type McpClient = typeof MCP_CLIENTS[number]['id']

export function isMcpClient(value: unknown): value is McpClient {
  return MCP_CLIENTS.some(client => client.id === value)
}
