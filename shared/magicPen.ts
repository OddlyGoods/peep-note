import { DEFAULT_AI_MODELS, type AiProvider } from './aiModels'
import { isCaptureCodexModel, normalizeCaptureCodexModel } from './codexModels'

export type MagicPenMode = 'api' | 'tool'
export type MagicPenModelKey = AiProvider | 'codex'
export const MAGIC_PEN_KEYS: MagicPenModelKey[] = ['openai', 'anthropic', 'gemini', 'qwen', 'codex']
export const MAGIC_PEN_PROVIDERS: Record<MagicPenModelKey, string> = { openai: 'OpenAI', anthropic: 'Claude', gemini: 'Gemini', qwen: 'Qwen', codex: 'Codex' }
export interface MagicPenSettings {
  mode: MagicPenMode
  models: Record<MagicPenModelKey, string>
  customModels: Partial<Record<MagicPenModelKey, string>>
}

export function getMagicPenSettings(saved?: unknown, legacyModel?: unknown, legacyCustom?: string): MagicPenSettings {
  let value = saved
  if (typeof value === 'string') { try { value = JSON.parse(value) } catch { value = null } }
  const data = value && typeof value === 'object' ? value as Partial<MagicPenSettings> : {}
  const result: MagicPenSettings = {
    mode: data.mode === 'api' ? 'api' : 'tool',
    models: { ...DEFAULT_AI_MODELS, codex: normalizeCaptureCodexModel(legacyModel) }, customModels: {},
  }
  for (const key of MAGIC_PEN_KEYS) {
    if (isCaptureCodexModel(data.customModels?.[key])) {
      result.customModels[key] = data.customModels![key]!.trim()
      result.models[key] = result.customModels[key]!
    }
    if (isCaptureCodexModel(data.models?.[key])) result.models[key] = data.models![key].trim()
  }
  if (!result.customModels.codex && isCaptureCodexModel(legacyCustom)) result.customModels.codex = legacyCustom.trim()
  return result
}

// An unfinished custom input must not block saving a different provider or mode.
export function magicPenDraft(value: MagicPenSettings, provider: AiProvider): MagicPenSettings | undefined {
  const key = value.mode === 'api' ? provider : 'codex'
  return isCaptureCodexModel(value.models[key]) ? getMagicPenSettings(value) : undefined
}

export function isMagicPenSettings(value: unknown): value is MagicPenSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const data = value as MagicPenSettings
  const validMap = (map: unknown, required: boolean) => !!map && typeof map === 'object' && !Array.isArray(map)
    && (!required || MAGIC_PEN_KEYS.every(key => isCaptureCodexModel((map as Record<string, unknown>)[key])))
    && Object.entries(map).every(([key, model]) => MAGIC_PEN_KEYS.includes(key as MagicPenModelKey) && isCaptureCodexModel(model))
  return (data.mode === 'api' || data.mode === 'tool') && validMap(data.models, true) && validMap(data.customModels, false)
}

// Credentials stay in the main process; only the selected provider label reaches the popup.
export function resolveMagicPen(row: Record<string, any> | null | undefined) {
  const config = getMagicPenSettings(row?.magic_pen, row?.capture_codex_model)
  const provider: MagicPenModelKey = config.mode === 'tool' ? 'codex'
    : MAGIC_PEN_KEYS.includes(row?.ai_provider) && row?.ai_provider !== 'codex' ? row!.ai_provider : 'openai'
  return { mode: config.mode, provider, model: config.models[provider], label: MAGIC_PEN_PROVIDERS[provider] }
}
