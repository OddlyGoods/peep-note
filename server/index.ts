import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { initDb } from './db'
import logs from './routes/logs'
import settings from './routes/settings'
import workspaces from './routes/workspaces'
import groups from './routes/groups'
import ai from './routes/ai'
import trash from './routes/trash'
import { purgeExpiredTrash } from './trash'

export function createApiApp(port: number) {
  const app = new Hono()
  const origins = ['http://localhost:5173', 'http://localhost:4173', 'http://127.0.0.1:5173', 'http://127.0.0.1:4173', 'app://dist']
  const hosts = [`localhost:${port}`, `127.0.0.1:${port}`]

  // This desktop API is intentionally account-free. Block unrelated websites
  // and DNS-rebinding hosts, including requests CORS alone would not stop.
  app.use('*', async (c, next) => {
    const host = c.req.header('host') ?? new URL(c.req.url).host
    const origin = c.req.header('origin')
    if (!hosts.includes(host) || (origin && !origins.includes(origin))
      || (!origin && c.req.header('sec-fetch-site') === 'cross-site')) {
      return c.json({ error: 'LOCAL_REQUEST_ONLY' }, 403)
    }
    await next()
  })

  app.use('*', cors({
    origin: origins,
    allowHeaders: ['Content-Type'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  }))

  app.route('/api/logs', logs)
  app.route('/api/settings', settings)
  app.route('/api/workspaces', workspaces)
  app.route('/api/groups', groups)
  app.route('/api/ai', ai)
  app.route('/api/trash', trash)

  app.get('/health', (c) => c.json({ status: 'ok', port }))
  return app
}

export async function startServer(port: number, userDataPath: string) {
  await initDb(userDataPath)
  purgeExpiredTrash()
  const trashCleanup = setInterval(() => {
    try { purgeExpiredTrash() } catch (error) { console.error('Trash cleanup failed:', error) }
  }, 60 * 60_000)
  trashCleanup.unref()
  const app = createApiApp(port)
  const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
    console.log(`Open PeepNote server running on http://127.0.0.1:${port}`)
  })
  server.on('close', () => clearInterval(trashCleanup))
  return server
}
