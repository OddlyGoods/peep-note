export interface CaptureCodexModel { value: string; label: string }
export const DEFAULT_CAPTURE_CODEX_MODEL = 'gpt-6.1-sol'
// Offline fallback. The installed CLI's bundled, visible image models take
// precedence; model access is checked by the analysis request itself.
export const CAPTURE_CODEX_MODELS: CaptureCodexModel[] = [
  { value: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
  { value: 'gpt-6.1-terra', label: 'GPT-6.1 Terra' },
  { value: 'gpt-6-astra', label: 'GPT-6 Astra' },
  { value: 'gpt-6-luna', label: 'GPT-6 Luna' },
]
export function isCaptureCodexModel(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(value.trim())
}
export function normalizeCaptureCodexModel(value: unknown): string {
  return isCaptureCodexModel(value) ? value.trim() : DEFAULT_CAPTURE_CODEX_MODEL
}
export function parseCodexModelCatalog(input: unknown): CaptureCodexModel[] {
  if (!input || typeof input !== 'object' || !Array.isArray((input as { models?: unknown }).models)) return []
  const entries = (input as { models: unknown[] }).models
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .filter(item => item.visibility === 'list' && isCaptureCodexModel(item.slug)
      && Array.isArray(item.input_modalities) && item.input_modalities.includes('image'))
    .sort((a, b) => Number(a.priority ?? 999) - Number(b.priority ?? 999))
  const unique = new Set<string>()
  return entries.flatMap(item => {
    const value = (item.slug as string).trim()
    if (unique.has(value)) return []
    unique.add(value)
    const label = typeof item.display_name === 'string' && item.display_name.trim() ? item.display_name.trim().slice(0, 100) : value
    return [{ value, label }]
  }).slice(0, 100)
}
