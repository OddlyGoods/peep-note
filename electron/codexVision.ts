import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { capturePrompt, type CaptureAnalysisError, type CaptureLanguage, type CaptureTurn } from '../shared/captureAnalysis'

import { isCaptureCodexModel } from '../shared/codexModels'

export class CodexVisionError extends Error {
  constructor(public code: CaptureAnalysisError) { super(code) }
}

export function findCodexLaunch(env: NodeJS.ProcessEnv = process.env, platform = process.platform) {
  const dirs = (env.PATH ?? '').split(path.delimiter).filter(Boolean)
  const home = os.homedir()
  dirs.push(path.join(home, '.local', 'bin'), path.join(home, '.npm-global', 'bin'), '/usr/local/bin', '/opt/homebrew/bin')
  if (env.APPDATA) dirs.push(path.join(env.APPDATA, 'npm'))
  const nvm = path.join(env.NVM_DIR || path.join(home, '.nvm'), 'versions', 'node')
  try { for (const version of fs.readdirSync(nvm).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) dirs.push(path.join(nvm, version, 'bin')) } catch {}
  for (const dir of dirs) {
    for (const file of platform === 'win32' ? ['codex.exe', 'node_modules/@openai/codex/bin/codex.js'] : ['codex']) {
      try {
        const resolved = fs.realpathSync(path.join(dir, file))
        if (!fs.statSync(resolved).isFile()) continue
        // Run npm's JS entry with Electron's bundled Node, without a shell or a
        // dependency on the login shell's Node/PATH (also handles Windows npm).
        if (/\.[cm]?js$/i.test(resolved)) return { command: process.execPath, prefix: [resolved], env: { ...env, ELECTRON_RUN_AS_NODE: '1' } }
        fs.accessSync(resolved, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK)
        return { command: resolved, prefix: [] as string[], env: { ...env } }
      } catch {}
    }
  }
  throw new CodexVisionError('cli_missing')
}

export interface CodexVisionInput {
  model: string; language: CaptureLanguage; turns: CaptureTurn[]; question: string; images: string[]
  directory: string; signal: AbortSignal; onText: (text: string) => void
}
export async function runCodexVision(input: CodexVisionInput, options: {
  launch?: ReturnType<typeof findCodexLaunch>
  timeoutMs?: number
  spawn?: typeof spawn
} = {}): Promise<string> {
  if (!isCaptureCodexModel(input.model)) throw new CodexVisionError('failed')
  if (input.signal.aborted) throw new Error('cancelled')
  const launch = options.launch ?? findCodexLaunch()
  const outputPath = path.join(input.directory, 'answer.md')
  await fs.promises.rm(outputPath, { force: true })
  const args = [...launch.prefix, 'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check',
    '--model', input.model.trim(), '--sandbox', 'read-only', '--disable', 'shell_tool', '--disable', 'apps', '--disable', 'plugins',
    '-c', 'approval_policy="never"', '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0',
    '--cd', input.directory, '--json', '--color', 'never', '--output-last-message', outputPath]
  for (const image of input.images) args.push('--image', image)
  args.push('-')
  return new Promise<string>((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams
    try { child = (options.spawn ?? spawn)(launch.command, args, { cwd: input.directory, env: launch.env, shell: false, windowsHide: true }) as ChildProcessWithoutNullStreams }
    catch { reject(new CodexVisionError('cli_missing')); return }
    let pending = '', bytes = 0, answer = '', diagnostics = '', protocolError = false, stopped = false, timedOut = false
    const stop = () => {
      if (stopped) return
      stopped = true
      if (process.platform === 'win32' && child.pid) {
        // npm's Codex shim launches a native child; terminate that whole owned
        // tree on Windows so closing the popup cannot leave inference running.
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' })
        killer.on('error', () => { child.kill() })
      } else child.kill()
      killTimer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL') }, 1500)
      killTimer.unref()
    }
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const timeout = setTimeout(() => { timedOut = true; stop() }, options.timeoutMs ?? 180_000)
    input.signal.addEventListener('abort', stop, { once: true })
    const cleanup = () => { clearTimeout(timeout); if (killTimer) clearTimeout(killTimer); input.signal.removeEventListener('abort', stop) }
    const line = (text: string) => {
      try {
        const event = JSON.parse(text)
        if (event.type === 'error' || event.type === 'turn.failed') {
          protocolError = true; diagnostics += JSON.stringify(event).slice(0, 3000)
        }
        if (['item.completed', 'item.updated'].includes(event.type) && event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
          answer = event.item.text.slice(0, 100_000); input.onText(answer)
        }
      } catch {}
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk)
      if (bytes > 2_000_000) { stop(); return }
      pending += chunk
      let index: number
      while ((index = pending.indexOf('\n')) >= 0) { line(pending.slice(0, index)); pending = pending.slice(index + 1) }
    })
    child.stderr.on('data', (chunk: string) => { diagnostics = (diagnostics + chunk).slice(-12_000) })
    child.stdin.on('error', () => {})
    child.stdin.end(capturePrompt(input.language, input.turns, input.question))
    child.once('error', () => { cleanup(); reject(new CodexVisionError('cli_missing')) })
    child.once('close', async code => {
      cleanup()
      if (pending) line(pending)
      if (!isCaptureCodexModel(input.model)) throw new CodexVisionError('failed')
  if (input.signal.aborted) { reject(new Error('cancelled')); return }
      if (timedOut) { reject(new CodexVisionError('timeout')); return }
      if (code !== 0 || stopped || protocolError) {
        reject(new CodexVisionError(/(?:not (?:logged|signed) in|login required|please (?:log|sign) in|unauthorized|401|token.*expired)/i.test(diagnostics) ? 'login_required' : 'failed')); return
      }
      try {
        if ((await fs.promises.stat(outputPath)).size <= 400_000) answer = (await fs.promises.readFile(outputPath, 'utf8')).trim() || answer
      } catch {}
      if (!answer.trim()) { reject(new CodexVisionError('failed')); return }
      resolve(answer.trim())
    })
  })
}
