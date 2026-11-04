import { AI_MODELS, DEFAULT_AI_MODELS } from './aiModels'
import { DEFAULT_CAPTURE_CODEX_MODEL, type CaptureCodexModel } from './codexModels'

export const MAGIC_PEN_TOOLS = ['codex', 'claude-code', 'gemini-cli', 'qwen-code'] as const
export type MagicPenTool = typeof MAGIC_PEN_TOOLS[number]
export const MAGIC_PEN_TOOL_LABELS: Record<MagicPenTool, string> = {
  codex: 'Codex', 'claude-code': 'Claude Code', 'gemini-cli': 'Gemini CLI', 'qwen-code': 'Qwen Code',
}
export const MAGIC_PEN_TOOL_MODELS: Record<Exclude<MagicPenTool, 'codex'>, readonly CaptureCodexModel[]> = {
  'claude-code': [{ value: 'sonnet', label: 'Sonnet' }, { value: 'opus', label: 'Opus' }, { value: 'haiku', label: 'Haiku' }],
  'gemini-cli': AI_MODELS.gemini,
  'qwen-code': [{ value: 'qwen3.6-plus', label: 'Qwen 3.6 Plus (Vision)' }, ...AI_MODELS.qwen],
}
export const DEFAULT_MAGIC_PEN_TOOL_MODELS: Record<MagicPenTool, string> = {
  codex: DEFAULT_CAPTURE_CODEX_MODEL, 'claude-code': 'sonnet', 'gemini-cli': DEFAULT_AI_MODELS.gemini, 'qwen-code': 'qwen3.6-plus',
}
export function isMagicPenTool(value: unknown): value is MagicPenTool {
  return typeof value === 'string' && MAGIC_PEN_TOOLS.includes(value as MagicPenTool)
}
