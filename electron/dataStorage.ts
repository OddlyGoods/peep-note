import { isLinkedAttachment } from '../shared/attachments'
import fs from 'node:fs'
import path from 'node:path'
import { isDataLocationMode, type DataLocationMode, type DataStorageErrorCode } from '../shared/dataStorage'
import { createEmptyDataFile } from '../server/db'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const initSqlJs = require('sql.js')

const databaseName = 'open-peep-note.db'
const managedEntries = [databaseName, 'settings.json', 'screenshots', 'videos', 'attachments', 'ocr-models']
const configName = 'storage-location.json'
type LocationConfig = { directory: string; pending?: string; pendingMode?: DataLocationMode }

export class DataStorageError extends Error {
  constructor(public code: DataStorageErrorCode) { super(code) }
}

function readConfig(profile: string): LocationConfig {
  const file = path.join(profile, configName)
  if (!fs.existsSync(file)) return { directory: profile }
  const config = JSON.parse(fs.readFileSync(file, 'utf8')) as LocationConfig
  if (typeof config.directory !== 'string' || !path.isAbsolute(config.directory)
    || (config.pending !== undefined && (typeof config.pending !== 'string' || !path.isAbsolute(config.pending)))
    || (config.pendingMode !== undefined && !isDataLocationMode(config.pendingMode))) {
    throw new DataStorageError('unavailable')
  }
  return config
}

function writeConfig(profile: string, config: LocationConfig) {
  fs.mkdirSync(profile, { recursive: true })
  const file = path.join(profile, configName)
  const temporary = `${file}.tmp`
  try {
    fs.writeFileSync(temporary, JSON.stringify(config), { mode: 0o600 })
    fs.renameSync(temporary, file)
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}

function contains(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export function validateDataLocation(profile: string, current: string, target: string, mode: DataLocationMode = 'copy') {
  try {
    if (!path.isAbsolute(target)) throw new DataStorageError('unavailable')
    const source = fs.realpathSync(current)
    const destination = fs.realpathSync(target)
    const profileRoot = fs.realpathSync(profile)
    if (source === destination) throw new DataStorageError('same')
    // Opening the original profile is supported when returning from a demo folder.
    if (!(mode === 'open' && destination === profileRoot) && (contains(source, destination) || contains(destination, source)
      || contains(profileRoot, destination) || contains(destination, profileRoot))) throw new DataStorageError('nested')
    if (!fs.statSync(destination).isDirectory()) throw new DataStorageError('unavailable')
    if (mode !== 'open' && fs.readdirSync(destination).length) throw new DataStorageError('notEmpty')
    if (mode === 'open') {
      const file = path.join(destination, databaseName)
      if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) throw new DataStorageError('invalidData')
      fs.accessSync(file, fs.constants.R_OK | fs.constants.W_OK)
    }
    fs.accessSync(destination, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK)
    const probe = path.join(destination, '.peepnote-write-test')
    fs.writeFileSync(probe, '', { flag: 'wx', mode: 0o600 })
    fs.unlinkSync(probe)
    return destination
  } catch (error) {
    if (error instanceof DataStorageError) throw error
    throw new DataStorageError('unavailable')
  }
}

async function validateExistingDatabase(directory: string) {
  const SQL = await initSqlJs()
  let database
  try {
    database = new SQL.Database(fs.readFileSync(path.join(directory, databaseName)))
    if (database.exec('PRAGMA quick_check')[0]?.values[0]?.[0] !== 'ok') throw new Error('Invalid database')
    database.exec('SELECT id, content FROM logs LIMIT 0; SELECT user_id FROM settings LIMIT 0; SELECT id, name FROM workspaces LIMIT 0')
  } catch { throw new DataStorageError('invalidData') }
  finally { database?.close() }
}

export async function scheduleDataLocation(profile: string, current: string, target: string, mode: DataLocationMode = 'copy') {
  if (!isDataLocationMode(mode)) throw new DataStorageError('unavailable')
  const destination = validateDataLocation(profile, current, target, mode)
  if (mode === 'open') await validateExistingDatabase(destination)
  writeConfig(profile, { directory: current, pending: destination, pendingMode: mode })
}

function copyEntry(source: string, destination: string) {
  const stat = fs.lstatSync(source)
  // Never follow links out of app-managed storage when copying a profile.
  if (stat.isSymbolicLink()) throw new DataStorageError('failed')
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { mode: 0o700 })
    for (const name of fs.readdirSync(source)) copyEntry(path.join(source, name), path.join(destination, name))
  } else if (stat.isFile()) {
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL)
    fs.chmodSync(destination, 0o600)
    if (fs.statSync(destination).size !== stat.size) throw new DataStorageError('failed')
  } else throw new DataStorageError('failed')
}

async function rewriteMediaPaths(databaseFile: string, source: string, destination: string) {
  if (!fs.existsSync(databaseFile)) throw new DataStorageError('failed')
  const SQL = await initSqlJs()
  const db = new SQL.Database(fs.readFileSync(databaseFile))
  const remap = (file: unknown) => {
    if (typeof file === 'string' && isLinkedAttachment(file)) return file
    if (typeof file !== 'string') return file
    const absolute = path.resolve(file)
    if (!['screenshots', 'videos', 'attachments'].some(dir => contains(path.join(source, dir), absolute))) return file
    return path.join(destination, path.relative(source, absolute))
  }
  try {
    const result = db.exec('SELECT id, file_path, attachments FROM logs')[0]
    for (const [id, file, attachments] of result?.values ?? []) {
      const parsed = JSON.parse(String(attachments || '[]'))
      if (!Array.isArray(parsed)) throw new DataStorageError('failed')
      db.run('UPDATE logs SET file_path = ?, attachments = ? WHERE id = ?', [remap(file), JSON.stringify(parsed.map(remap)), id])
    }
    if (db.exec('PRAGMA table_info(comments)')[0]?.values.some((column: unknown[]) => column[1] === 'attachments')) {
      for (const [id, attachments] of db.exec('SELECT id, attachments FROM comments')[0]?.values ?? []) {
        const parsed = JSON.parse(String(attachments || '[]'))
        if (!Array.isArray(parsed)) throw new DataStorageError('failed')
        db.run('UPDATE comments SET attachments = ? WHERE id = ?', [JSON.stringify(parsed.map(remap)), id])
      }
    }
    fs.writeFileSync(databaseFile, Buffer.from(db.export()), { mode: 0o600 })
  } finally { db.close() }
}

// Run before the database/server opens. Live writes and unfinished requests from
// the previous process have stopped, so the copy uses a consistent disk snapshot.
export async function prepareDataLocation(profile: string): Promise<{ directory: string; error?: DataStorageErrorCode }> {
  fs.mkdirSync(profile, { recursive: true })
  const config = readConfig(profile)
  const current = config.directory
  // An unplugged custom drive must never silently create an empty database.
  if (current !== profile && (!fs.existsSync(path.join(current, databaseName)) || !fs.statSync(current).isDirectory())) {
    throw new DataStorageError('unavailable')
  }
  fs.accessSync(current, fs.constants.R_OK | fs.constants.W_OK)
  if (!config.pending) return { directory: current }
  let staging: string | undefined
  try {
    const mode = config.pendingMode ?? 'copy'
    const destination = validateDataLocation(profile, current, config.pending, mode)
    if (mode === 'open') {
      await validateExistingDatabase(destination)
      writeConfig(profile, { directory: destination })
      return { directory: destination }
    }
    staging = fs.mkdtempSync(path.join(path.dirname(destination), '.peepnote-copy-'))
    if (mode === 'new') await createEmptyDataFile(staging)
    else {
      for (const name of managedEntries) {
        const source = path.join(current, name)
        if (fs.existsSync(source)) copyEntry(source, path.join(staging, name))
      }
      await rewriteMediaPaths(path.join(staging, databaseName), current, destination)
    }
    // No existing files may be merged or replaced. Only remove the empty folder
    // chosen by the user; a concurrent addition makes rmdir fail safely.
    fs.rmdirSync(destination)
    fs.renameSync(staging, destination)
    staging = undefined
    writeConfig(profile, { directory: destination })
    return { directory: destination }
  } catch (error) {
    // Originals are never removed, including when copying or config writes fail.
    if (staging) fs.rmSync(staging, { recursive: true, force: true })
    writeConfig(profile, { directory: current })
    return { directory: current, error: error instanceof DataStorageError ? error.code : 'failed' }
  }
}
