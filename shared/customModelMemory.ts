import { AI_MODELS, type AiModelMap, type AiProvider } from './aiModels'
import { CAPTURE_CODEX_MODELS } from './codexModels'

const keys = ['openai', 'anthropic', 'gemini', 'qwen', 'codex'] as const
export type CustomModelKey = typeof keys[number]
export type CustomModelMemory = Partial<Record<CustomModelKey, string>>
export function isCustomModelMemory(value: unknown): value is CustomModelMemory {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).every(([key, model]) => keys.includes(key as CustomModelKey) && typeof model === 'string' && !!model.trim())
}
export function getCustomModelMemory(saved: unknown, models?: AiModelMap, codex?: string): CustomModelMemory {
  let input = saved
  if (typeof input === 'string') { try { input = JSON.parse(input) } catch { input = null } }
  const memory: CustomModelMemory = {}
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const key of keys) {
      const value = (input as Record<string, unknown>)[key]
      if (typeof value === 'string' && value.trim()) memory[key] = value.trim()
    }
  }
  // Preserve custom values from older installations before a preset replaces
  // their active model. Never replace already remembered custom input.
  for (const provider of Object.keys(models ?? {}) as AiProvider[]) {
    const model = models![provider]
    if (!memory[provider] && model?.trim() && !AI_MODELS[provider].some(option => option.value === model)) memory[provider] = model.trim()
  }
  if (!memory.codex && codex?.trim() && !CAPTURE_CODEX_MODELS.some(option => option.value === codex)) memory.codex = codex.trim()
  return memory
}
