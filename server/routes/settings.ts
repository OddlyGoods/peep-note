import { Hono } from 'hono'
import { queryOne, run } from '../db'
import { LOCAL_PROFILE_ID } from '../localProfile'
import crypto from 'crypto'
import { DEFAULT_TRASH_RETENTION_DAYS, isTrashRetentionDays, normalizeTrashRetentionDays } from '../../shared/trashRetention'
import { DEFAULT_AI_MODELS, type AiProvider } from '../../shared/aiModels'
import { resolveHotkeys } from '../../shared/hotkeys'

const settings = new Hono()
const isSupportedLanguage = (value: unknown): value is 'en' | 'ko' | 'ja' | 'zh' =>
  value === 'en' || value === 'ko' || value === 'ja' || value === 'zh'


settings.get('/', async (c) => {
  const userId = LOCAL_PROFILE_ID

  const row = queryOne<any>('SELECT * FROM settings WHERE user_id = ?', [userId])
  if (!row) return c.json({
    hotkeys: resolveHotkeys(),
    backup_enabled: false, backup_url: null, theme: 'light', trash_retention_days: DEFAULT_TRASH_RETENTION_DAYS,
    ai_provider: 'openai', ai_model: DEFAULT_AI_MODELS.openai, openai_api_key: null, anthropic_api_key: null, gemini_api_key: null, qwen_api_key: null, qwen_base_url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', language: 'en', auto_advance_date_range: true, fixed_start_date: false, secret_password_set: false
  })
  const { secret_password_hash: _secretPasswordHash, ...safeRow } = row
  return c.json({ ...safeRow, trash_retention_days: normalizeTrashRetentionDays(row.trash_retention_days), secret_password_set: !!_secretPasswordHash, hotkeys: resolveHotkeys(JSON.parse(row.hotkeys || '{}')), backup_enabled: !!row.backup_enabled, auto_advance_date_range: row.auto_advance_date_range !== 0, fixed_start_date: !!row.fixed_start_date })
})

const isPin = (value: unknown): value is string => typeof value === 'string' && /^\d{4}$/.test(value)
const secretHash = (pin: string, userId: string) => crypto.scryptSync(pin, `peepnote-secret-v1:${userId}`, 32).toString('hex')
const matchingSecret = (pin: string, hash: string, userId: string) => {
  const expected = Buffer.from(secretHash(pin, userId), 'hex')
  const actual = Buffer.from(hash, 'hex')
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
}

settings.get('/secret-password/status', async (c) => {
  const userId = LOCAL_PROFILE_ID
  const row = queryOne<{ secret_password_hash: string | null }>('SELECT secret_password_hash FROM settings WHERE user_id = ?', [userId])
  return c.json({ is_set: !!row?.secret_password_hash })
})

settings.post('/secret-password/verify', async (c) => {
  const userId = LOCAL_PROFILE_ID
  const { password } = await c.req.json()
  if (!isPin(password)) return c.json({ error: 'INVALID_SECRET_PASSWORD' }, 400)
  const row = queryOne<{ secret_password_hash: string | null }>('SELECT secret_password_hash FROM settings WHERE user_id = ?', [userId])
  if (!row?.secret_password_hash) return c.json({ error: 'SECRET_PASSWORD_NOT_SET' }, 404)
  if (!matchingSecret(password, row.secret_password_hash, userId)) return c.json({ error: 'SECRET_PASSWORD_INCORRECT' }, 403)
  return c.json({ ok: true })
})

settings.put('/secret-password', async (c) => {
  const userId = LOCAL_PROFILE_ID
  const { password, current_password } = await c.req.json()
  if (!isPin(password)) return c.json({ error: 'INVALID_SECRET_PASSWORD' }, 400)
  const row = queryOne<{ secret_password_hash: string | null }>('SELECT secret_password_hash FROM settings WHERE user_id = ?', [userId])
  if (row?.secret_password_hash && (!isPin(current_password) || !matchingSecret(current_password, row.secret_password_hash, userId))) {
    return c.json({ error: 'SECRET_PASSWORD_INCORRECT' }, 403)
  }
  const hash = secretHash(password, userId)
  if (row) run('UPDATE settings SET secret_password_hash = ?, updated_at = ? WHERE user_id = ?', [hash, Math.floor(Date.now() / 1000), userId])
  else run('INSERT INTO settings (user_id, secret_password_hash, updated_at) VALUES (?, ?, ?)', [userId, hash, Math.floor(Date.now() / 1000)])
  return c.json({ ok: true })
})

settings.put('/', async (c) => {
  const userId = LOCAL_PROFILE_ID

  const { hotkeys, backup_enabled, backup_url, theme, ai_provider, ai_model, openai_api_key, anthropic_api_key, gemini_api_key, qwen_api_key, qwen_base_url, language, auto_advance_date_range, fixed_start_date, trash_retention_days } = await c.req.json()
  if (fixed_start_date !== undefined && typeof fixed_start_date !== 'boolean') {
    return c.json({ error: 'INVALID_FIXED_START_DATE' }, 400)
  }
  if (ai_provider !== undefined && !Object.prototype.hasOwnProperty.call(DEFAULT_AI_MODELS, ai_provider)) {
    return c.json({ error: 'INVALID_AI_PROVIDER' }, 400)
  }
  if (ai_model !== undefined && (typeof ai_model !== 'string' || !ai_model.trim())) {
    return c.json({ error: 'INVALID_AI_MODEL' }, 400)
  }
  if (trash_retention_days !== undefined && !isTrashRetentionDays(trash_retention_days)) {
    return c.json({ error: 'INVALID_TRASH_RETENTION_DAYS' }, 400)
  }
  const now = Math.floor(Date.now() / 1000)
  const cur = queryOne<any>('SELECT * FROM settings WHERE user_id = ?', [userId])
  const provider = (ai_provider ?? cur?.ai_provider ?? 'openai') as AiProvider
  const model = ai_model?.trim() ?? (
    ai_provider && provider !== cur?.ai_provider
      ? DEFAULT_AI_MODELS[provider]
      : cur?.ai_model ?? DEFAULT_AI_MODELS[provider]
  )

  if (cur) {
    run(
      'UPDATE settings SET hotkeys=?, backup_enabled=?, backup_url=?, theme=?, ai_provider=?, ai_model=?, openai_api_key=?, anthropic_api_key=?, gemini_api_key=?, qwen_api_key=?, qwen_base_url=?, language=?, auto_advance_date_range=?, fixed_start_date=?, trash_retention_days=?, updated_at=? WHERE user_id=?',
      [
        hotkeys ? JSON.stringify(hotkeys) : cur.hotkeys,
        backup_enabled !== undefined ? (backup_enabled ? 1 : 0) : cur.backup_enabled,
        backup_url !== undefined ? backup_url : cur.backup_url,
        theme ?? cur.theme,
        provider,
        model,
        openai_api_key !== undefined ? openai_api_key : cur.openai_api_key,
        anthropic_api_key !== undefined ? anthropic_api_key : cur.anthropic_api_key,
        gemini_api_key !== undefined ? gemini_api_key : cur.gemini_api_key,
        qwen_api_key !== undefined ? qwen_api_key : cur.qwen_api_key,
        qwen_base_url !== undefined ? qwen_base_url : (cur.qwen_base_url ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'),
        isSupportedLanguage(language) ? language : (cur.language ?? 'en'),
        auto_advance_date_range !== undefined ? (auto_advance_date_range ? 1 : 0) : (cur.auto_advance_date_range ?? 1),
        fixed_start_date !== undefined ? (fixed_start_date ? 1 : 0) : (cur.fixed_start_date ?? 0),
        trash_retention_days ?? normalizeTrashRetentionDays(cur.trash_retention_days),
        now, userId
      ]
    )
  } else {
    run(
      'INSERT INTO settings (user_id, hotkeys, backup_enabled, backup_url, theme, ai_provider, ai_model, openai_api_key, anthropic_api_key, gemini_api_key, qwen_api_key, qwen_base_url, language, auto_advance_date_range, fixed_start_date, trash_retention_days, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [userId,
       JSON.stringify(resolveHotkeys(hotkeys)),
       backup_enabled ? 1 : 0, backup_url ?? null, theme ?? 'light',
       provider, model, openai_api_key ?? null, anthropic_api_key ?? null, gemini_api_key ?? null, qwen_api_key ?? null, qwen_base_url ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', isSupportedLanguage(language) ? language : 'en', auto_advance_date_range === false ? 0 : 1, fixed_start_date ? 1 : 0, trash_retention_days ?? DEFAULT_TRASH_RETENTION_DAYS, now]
    )
  }

  const row = queryOne<any>('SELECT * FROM settings WHERE user_id = ?', [userId])!
  const { secret_password_hash: _secretPasswordHash, ...safeRow } = row
  return c.json({ ...safeRow, trash_retention_days: normalizeTrashRetentionDays(row.trash_retention_days), secret_password_set: !!_secretPasswordHash, hotkeys: resolveHotkeys(JSON.parse(row.hotkeys || '{}')), backup_enabled: !!row.backup_enabled, auto_advance_date_range: row.auto_advance_date_range !== 0, fixed_start_date: !!row.fixed_start_date })
})

export default settings
