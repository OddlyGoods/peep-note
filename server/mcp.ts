import { Hono } from 'hono'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createPeepNoteMcp } from './mcpTools'
import type { McpAccess } from './mcpAccess'

export function mcpControl(access: McpAccess, port: number) {
  const app = new Hono()
  const endpoint = `http://127.0.0.1:${port}/mcp`
  app.get('/', c => c.json({ enabled: access.enabled, endpoint }))
  app.put('/', async c => {
    const body = await c.req.json().catch(() => null)
    if (typeof body?.enabled !== 'boolean') return c.json({ error: 'INVALID_MCP_SETTING' }, 400)
    try {
      access.setEnabled(body.enabled)
      return c.json({ enabled: access.enabled, endpoint })
    } catch { return c.json({ error: 'MCP_SETTING_FAILED' }, 500) }
  })
  app.get('/config', c => {
    if (!access.enabled) return c.json({ error: 'MCP_DISABLED' }, 409)
    c.header('Cache-Control', 'no-store')
    return c.json({ config: access.codexConfig(endpoint) })
  })
  return app
}

export function mcpEndpoint(access: McpAccess, onChanged: () => void) {
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
    const server = createPeepNoteMcp(onChanged, () => access.accepts(authorization))
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 1_048_576 })
    try {
      await server.connect(transport)
      return await transport.handleRequest(c.req.raw)
    } catch { return c.json({ error: 'MCP_REQUEST_FAILED' }, 500) }
    finally { await server.close() }
  })
  return app
}
