import type { Database, SqlValue } from 'sql.js'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const initSqlJs = require('sql.js')

let db: Database
let dbPath: string
let userDataPath: string
let transactionDepth = 0

export function getDb() {
  return db
}

export function getUserDataPath() {
  return userDataPath
}

function persist() {
  const data = db.export()
  const temporaryPath = `${dbPath}.tmp`
  fs.writeFileSync(temporaryPath, Buffer.from(data))
  fs.renameSync(temporaryPath, dbPath)
}

export async function initDb(appDataPath: string) {
  // Keep the application data root available to route handlers that need to
  // clean up managed media files.
  userDataPath = appDataPath
  dbPath = path.join(appDataPath, 'open-peep-note.db')

  const SQL = await initSqlJs()

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath)
    db = new SQL.Database(fileBuffer)
  } else {
    db = new SQL.Database()
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS logs (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      title      TEXT NOT NULL DEFAULT '',
      content    TEXT NOT NULL DEFAULT '',
      log_type   TEXT NOT NULL DEFAULT 'note',
      file_path  TEXT,
      tags       TEXT NOT NULL DEFAULT '[]',
      pinned     INTEGER NOT NULL DEFAULT 0,
      is_secret  INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      user_id        TEXT PRIMARY KEY,
      hotkeys        TEXT NOT NULL DEFAULT '{}',
      backup_enabled INTEGER NOT NULL DEFAULT 0,
      backup_url     TEXT,
      theme          TEXT NOT NULL DEFAULT 'light',
      updated_at     INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      name       TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS log_groups (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      name         TEXT NOT NULL,
      workspace_id TEXT,
      created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS comments (
      id         TEXT PRIMARY KEY,
      log_id     TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `)

  // 마이그레이션
  try { db.run("ALTER TABLE logs ADD COLUMN content_format TEXT NOT NULL DEFAULT 'text'") } catch {}
  try { db.run("ALTER TABLE logs ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'") } catch {}
  try { db.run("ALTER TABLE logs ADD COLUMN workspace_id TEXT") } catch {}
  try { db.run("ALTER TABLE logs ADD COLUMN group_id TEXT") } catch {}
  try { db.run('ALTER TABLE logs ADD COLUMN is_secret INTEGER NOT NULL DEFAULT 0') } catch {}
  try { db.run("ALTER TABLE settings ADD COLUMN openai_api_key TEXT") } catch {}
  try { db.run("ALTER TABLE settings ADD COLUMN ai_provider TEXT NOT NULL DEFAULT 'openai'") } catch {}
  try { db.run("ALTER TABLE settings ADD COLUMN anthropic_api_key TEXT") } catch {}
  try { db.run("ALTER TABLE settings ADD COLUMN gemini_api_key TEXT") } catch {}
  try { db.run("ALTER TABLE settings ADD COLUMN qwen_api_key TEXT") } catch {}
  try { db.run("ALTER TABLE settings ADD COLUMN qwen_base_url TEXT") } catch {}
  try { db.run('ALTER TABLE settings ADD COLUMN ai_model TEXT') } catch {}
  try { db.run("ALTER TABLE settings ADD COLUMN language TEXT NOT NULL DEFAULT 'en'") } catch {}
  try { db.run('ALTER TABLE settings ADD COLUMN auto_advance_date_range INTEGER NOT NULL DEFAULT 1') } catch {}
  try { db.run('ALTER TABLE settings ADD COLUMN fixed_start_date INTEGER NOT NULL DEFAULT 1') } catch {}
  try { db.run('ALTER TABLE settings ADD COLUMN trash_retention_days INTEGER NOT NULL DEFAULT 10') } catch {}
  try { db.run('ALTER TABLE settings ADD COLUMN secret_password_hash TEXT') } catch {}
  try { db.run('ALTER TABLE logs ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0') } catch {}
  try { db.run('ALTER TABLE logs ADD COLUMN deleted_at INTEGER') } catch {}
  try { db.run("ALTER TABLE logs ADD COLUMN ocr_text TEXT NOT NULL DEFAULT ''") } catch {}
  try { db.run("ALTER TABLE logs ADD COLUMN ocr_status TEXT NOT NULL DEFAULT 'idle'") } catch {}
  // Cancel legacy automatic jobs and interrupted requests; extraction requires a new click.
  db.run("UPDATE logs SET ocr_status = 'idle' WHERE ocr_status IN ('pending', 'processing')")
  // Early AI summaries did not store their group's workspace and appeared in General.
  db.run(`UPDATE logs
    SET workspace_id = (SELECT workspace_id FROM log_groups WHERE id = logs.group_id AND user_id = logs.user_id)
    WHERE log_type = 'summary'
      AND group_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM log_groups
        WHERE id = logs.group_id
          AND user_id = logs.user_id
          AND workspace_id IS NOT NULL
          AND (logs.workspace_id IS NULL OR logs.workspace_id != workspace_id)
      )`)
  db.run('CREATE INDEX IF NOT EXISTS logs_user_deleted_date ON logs(user_id, deleted_at, created_at)')

  persist()
  return db
}

export function queryOne<T>(sql: string, params: unknown[] = []): T | null {
  const stmt = db.prepare(sql)
  stmt.bind(params as SqlValue[])
  if (stmt.step()) {
    const row = stmt.getAsObject() as T
    stmt.free()
    return row
  }
  stmt.free()
  return null
}

export function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  const stmt = db.prepare(sql)
  stmt.bind(params as SqlValue[])
  const rows: T[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T)
  }
  stmt.free()
  return rows
}

export function run(sql: string, params: unknown[] = []): void {
  db.run(sql, params as SqlValue[])
  if (transactionDepth === 0) persist()
}

export function transaction<T>(operation: () => T): T {
  if (transactionDepth > 0) return operation()
  db.run('BEGIN')
  transactionDepth += 1
  let result: T
  try {
    result = operation()
    db.run('COMMIT')
  } catch (error) {
    db.run('ROLLBACK')
    throw error
  } finally {
    transactionDepth -= 1
  }
  persist()
  return result
}

export function generateId(): string {
  return crypto.randomUUID()
}
