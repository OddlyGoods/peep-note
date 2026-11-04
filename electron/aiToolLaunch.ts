import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { MagicPenTool } from '../shared/magicPenTools'

const executables: Record<MagicPenTool, string> = { codex: 'codex', 'claude-code': 'claude', 'gemini-cli': 'gemini', 'qwen-code': 'qwen' }
const npmEntries: Record<MagicPenTool, string[]> = {
  codex: ['@openai/codex/bin/codex.js'],
  'claude-code': ['@anthropic-ai/claude-code/bin/claude.exe', '@anthropic-ai/claude-code/cli.js'],
  'gemini-cli': ['@google/gemini-cli/bundle/gemini.js', '@google/gemini-cli/dist/index.js'],
  'qwen-code': ['@qwen-code/qwen-code/cli-entry.js', '@qwen-code/qwen-code/cli.js', '@qwen-code/qwen-code/dist/cli.js'],
}
export interface AiToolLaunch { command: string; prefix: string[]; env: NodeJS.ProcessEnv }

// GUI apps may not inherit a login shell's PATH. Resolve native binaries and
// npm entries explicitly; never invoke a .cmd shim or a shell on Windows.
export function findAiToolLaunch(tool: MagicPenTool, env: NodeJS.ProcessEnv = process.env, platform = process.platform, home = os.homedir()): AiToolLaunch {
  const dirs = (env.PATH ?? '').split(platform === 'win32' ? ';' : path.delimiter).filter(Boolean)
  dirs.push(path.join(home, '.local', 'bin'), path.join(home, '.npm-global', 'bin'), '/usr/local/bin', '/opt/homebrew/bin')
  if (env.APPDATA) dirs.push(path.join(env.APPDATA, 'npm'))
  if (env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'))
  const nvm = path.join(env.NVM_DIR || path.join(home, '.nvm'), 'versions', 'node')
  try { for (const version of fs.readdirSync(nvm).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) dirs.push(path.join(nvm, version, 'bin')) } catch {}
  const files = [...(platform === 'win32' ? [`${executables[tool]}.exe`] : [executables[tool]]), ...npmEntries[tool].map(entry => path.join('node_modules', entry))]
  for (const dir of dirs) for (const file of files) {
    try {
      const resolved = fs.realpathSync(path.join(dir, file))
      if (!fs.statSync(resolved).isFile()) continue
      if (/\.[cm]?js$/i.test(resolved)) return { command: process.execPath, prefix: [resolved], env: { ...env, ELECTRON_RUN_AS_NODE: '1' } }
      fs.accessSync(resolved, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK)
      return { command: resolved, prefix: [], env: { ...env } }
    } catch {}
  }
  throw new Error('AI_TOOL_NOT_FOUND')
}
