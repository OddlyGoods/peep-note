import type { McpChangeListener } from '../shared/mcpEvents'
import { Hono } from 'hono'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createPeepNoteMcp } from './mcpTools'
import type { McpAccess } from './mcpAccess'
import { isMcpClient } from '../shared/mcpClients'

export function mcpControl(access: McpAccess, port: number, onChanged: McpChangeListener = () => {}) {
  const app = new Hono()
  const endpoint = `http://127.0.0.1:${port}/mcp`
  const status = () => ({ enabled: access.enabled, endpoint, notificationsEnabled: access.notificationsEnabled })
  app.get('/', c => c.json(status()))
  app.put('/', async c => {
    const body = await c.req.json().catch(() => null)
    if (typeof body?.enabled !== 'boolean') return c.json({ error: 'INVALID_MCP_SETTING' }, 400)
    try {
      access.setEnabled(body.enabled)
      return c.json(status())
    } catch { return c.json({ error: 'MCP_SETTING_FAILED' }, 500) }
  })
  app.put('/notifications', async c => {
    const body = await c.req.json().catch(() => null)
    if (typeof body?.enabled !== 'boolean') return c.json({ error: 'INVALID_MCP_SETTING' }, 400)
    try {
      access.setNotificationsEnabled(body.enabled)
      try { onChanged({ notificationsEnabled: access.notificationsEnabled }) } catch { /* The preference is already saved. */ }
      return c.json(status())
    } catch { return c.json({ error: 'MCP_SETTING_FAILED' }, 500) }
  })
  app.get('/config', c => {
    c.header('Cache-Control', 'no-store')
    if (!access.enabled) return c.json({ error: 'MCP_DISABLED' }, 409)
    const client = c.req.query('client') ?? 'codex'
    if (!isMcpClient(client)) return c.json({ error: 'INVALID_MCP_CLIENT' }, 400)
    return c.json({ config: access.clientConfig(endpoint, client) })
  })
  return app
}

export function mcpEndpoint(access: McpAccess, onChanged: McpChangeListener) {
  const app = new Hono()
  app.all('/', async c => {
    c.header('Cache-Control', 'no-store')
    if (!access.enabled) return c.json({ error: 'MCP_DISABLED' }, 404)
    // Browser pages cannot use the MCP endpoint, even with a copied token.
    if (c.req.header('origin')) return c.json({ error: 'LOCAL_MCP_CLIENT_ONLY' }, 403)
    const authorization = c.req.header('authorization')
    if (!access.accepts(authorization)) return c.json({ error: 'MCP_UNAUTHORIZED' }, 401)
    if (c.req.method !== 'POST') {
      c.header('Allow', 'POST')
      return c.json({ error: 'METHOD_NOT_ALLOWED' }, 405)
    }
    const server = createPeepNoteMcp(change => {
      onChanged(change?.noteSaved && !access.notificationsEnabled ? undefined : change)
    }, () => access.accepts(authorization))
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 1_048_576 })
    try {
      await server.connect(transport)
      return await transport.handleRequest(c.req.raw)
    } catch { return c.json({ error: 'MCP_REQUEST_FAILED' }, 500) }
    finally { await server.close() }
  })
  return app
}
