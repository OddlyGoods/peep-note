export type AiProvider = 'openai' | 'anthropic' | 'gemini' | 'qwen'

// Official catalogs checked 2026-10-27; newest model generations first.
// https://developers.openai.com/api/docs/models
// https://platform.claude.com/docs/en/models/overview
// https://ai.google.dev/gemini-api/docs/models
// https://www.alibabacloud.com/help/en/model-studio/models
export const AI_MODELS = {
  openai: [
    { value: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
    { value: 'gpt-6.1-terra', label: 'GPT-6.1 Terra' },
    { value: 'gpt-6-astra', label: 'GPT-6 Astra' },
    { value: 'gpt-6-luna', label: 'GPT-6 Luna' }
  ],
  anthropic: [
    { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
    { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
    { value: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
    { value: 'claude-fable-5-1', label: 'Claude Fable 5.1' }
  ],
  gemini: [
    { value: 'gemini-4-argon', label: 'Gemini 4 Argon' },
    { value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    { value: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
    { value: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' },
    { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' }
  ],
  qwen: [
    { value: 'qwen3.8-max', label: 'Qwen 3.8 Max' },
    { value: 'qwen3.8-flash', label: 'Qwen 3.8 Flash' },
    { value: 'qwen3.7-plus', label: 'Qwen 3.7 Plus' },
    { value: 'qwen3.7-flash', label: 'Qwen 3.7 Flash' }
  ]
} as const

// Keep fresh configurations on efficient models; never replace a saved model ID.
export const DEFAULT_AI_MODELS: Record<AiProvider, string> = {
  openai: 'gpt-6-luna',
  anthropic: 'claude-haiku-5-5',
  gemini: 'gemini-3.8-flash',
  qwen: 'qwen3.7-plus'
}

export function getAiModelSelection(provider: AiProvider, savedModel?: string | null) {
  const model = savedModel?.trim() || DEFAULT_AI_MODELS[provider]
  return { model, custom: !AI_MODELS[provider].some(option => option.value === model) }
}
