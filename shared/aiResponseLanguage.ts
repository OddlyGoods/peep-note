export const AI_RESPONSE_LANGUAGES = [
  { value: 'en', label: 'English', name: 'English' },
  { value: 'ko', label: '한국어', name: 'Korean' },
  { value: 'ja', label: '日本語', name: 'Japanese' },
  { value: 'zh', label: '简体中文', name: 'Simplified Chinese' },
  { value: 'zh-TW', label: '繁體中文', name: 'Traditional Chinese' },
  { value: 'es', label: 'Español', name: 'Spanish' },
  { value: 'fr', label: 'Français', name: 'French' },
  { value: 'de', label: 'Deutsch', name: 'German' },
  { value: 'pt', label: 'Português', name: 'Portuguese' },
  { value: 'it', label: 'Italiano', name: 'Italian' },
  { value: 'ru', label: 'Русский', name: 'Russian' },
  { value: 'ar', label: 'العربية', name: 'Arabic' },
  { value: 'hi', label: 'हिन्दी', name: 'Hindi' },
  { value: 'id', label: 'Bahasa Indonesia', name: 'Indonesian' },
  { value: 'vi', label: 'Tiếng Việt', name: 'Vietnamese' },
  { value: 'th', label: 'ไทย', name: 'Thai' },
  { value: 'tr', label: 'Türkçe', name: 'Turkish' },
  { value: 'nl', label: 'Nederlands', name: 'Dutch' },
  { value: 'pl', label: 'Polski', name: 'Polish' },
  { value: 'sv', label: 'Svenska', name: 'Swedish' },
  { value: 'uk', label: 'Українська', name: 'Ukrainian' },
  { value: 'bn', label: 'বাংলা', name: 'Bengali' },
  { value: 'ur', label: 'اردو', name: 'Urdu' },
  { value: 'fa', label: 'فارسی', name: 'Persian' },
  { value: 'he', label: 'עברית', name: 'Hebrew' },
] as const
export type AiResponseLanguage = typeof AI_RESPONSE_LANGUAGES[number]['value']
export type AiResponseLanguagePreference = 'auto' | AiResponseLanguage
export function isAiResponseLanguagePreference(value: unknown): value is AiResponseLanguagePreference {
  return value === 'auto' || AI_RESPONSE_LANGUAGES.some(language => language.value === value)
}
export function normalizeAiResponseLanguage(value: unknown): AiResponseLanguagePreference {
  return isAiResponseLanguagePreference(value) ? value : 'auto'
}
export function resolveAiResponseLanguage(preference: unknown, appLanguage: unknown): AiResponseLanguage {
  const selected = normalizeAiResponseLanguage(preference)
  return selected !== 'auto' ? selected : AI_RESPONSE_LANGUAGES.find(language => language.value === appLanguage)?.value ?? 'en'
}
export function aiResponseLanguageName(language: AiResponseLanguage): string {
  return AI_RESPONSE_LANGUAGES.find(item => item.value === language)?.name ?? 'English'
}
