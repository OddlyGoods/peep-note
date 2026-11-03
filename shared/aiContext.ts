export const DEFAULT_AI_CONTEXT_LENGTH = 32768
export const MIN_AI_CONTEXT_LENGTH = 2048
export const MAX_AI_CONTEXT_LENGTH = 2097152

export function isAiContextLength(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= MIN_AI_CONTEXT_LENGTH && value <= MAX_AI_CONTEXT_LENGTH
}

export function normalizeAiContextLength(value: unknown): number {
  return isAiContextLength(value) ? value : DEFAULT_AI_CONTEXT_LENGTH
}
