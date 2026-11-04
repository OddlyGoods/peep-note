import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { capturePrompt } from '../shared/captureAnalysis'
import { isCaptureCodexModel } from '../shared/codexModels'
import type { MagicPenTool } from '../shared/magicPenTools'
import { findAiToolLaunch, type AiToolLaunch } from './aiToolLaunch'
import { CodexVisionError, runCodexVision, type CodexVisionInput } from './codexVision'

interface Options { launch?: AiToolLaunch; timeoutMs?: number; spawn?: typeof spawn }

async function toolRequest(tool: Exclude<MagicPenTool, 'codex'>, input: CodexVisionInput) {
  let bytes = 0
  for (const file of input.images) {
    bytes += (await fs.stat(file)).size
    if (bytes > 12 * 1024 * 1024) throw new CodexVisionError('image_limit')
  }
  const prompt = capturePrompt(input.language, input.turns, input.question, input.responseLanguage)
  if (tool === 'claude-code') {
    const content = []
    for (const file of input.images) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: (await fs.readFile(file)).toString('base64') } })
    content.push({ type: 'text', text: prompt })
    return { args: ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--model', input.model, '--no-session-persistence', '--safe-mode', '--tools', '', '--permission-mode', 'dontAsk',
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands', '--no-chrome'],
      stdin: JSON.stringify({ type: 'user', session_id: '', parent_tool_use_id: null, message: { role: 'user', content } }) + '\n', env: {} }
  }
  // These CLIs attach local images through @ references, not through their
  // stream-json user-message schema. Use only app-owned, simple relative names.
  const refs: string[] = []
  for (const [index, file] of input.images.entries()) {
    const name = `pen-input-${index}.png`
    await fs.copyFile(file, path.join(input.directory, name))
    refs.push(`@./${name}`)
  }
  // Quoted history may contain @ paths. Encode those as JSON unicode escapes
  // so the CLI cannot expand an unrelated file or MCP resource from that data.
  const stdin = `${refs.join('\n')}\n\n${prompt.replace(/@/g, '\\u0040')}\n`
  if (tool === 'qwen-code') {
    return { args: ['--prompt', 'Analyze the attached content using the instructions from stdin.', '--model', input.model,
      '--output-format', 'stream-json', '--safe-mode', '--no-chat-recording', '--exclude-tools', '*', '--max-tool-calls', '0'], stdin, env: {} }
  }
  const settingsFile = path.join(input.directory, 'gemini-settings.json'), policyFile = path.join(input.directory, 'gemini-policy.toml')
  await fs.writeFile(policyFile, '[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 999\n')
  await fs.writeFile(settingsFile, JSON.stringify({
    admin: { mcp: { enabled: false }, extensions: { enabled: false }, skills: { enabled: false } },
    tools: { core: ['peepnote_no_tools'] }, hooksConfig: { enabled: false },
    context: { fileName: 'PEEPNOTE_NO_CONTEXT.md' }, telemetry: { enabled: false },
    experimental: { enableAgents: false }, adminPolicyPaths: [policyFile],
  }))
  return { args: ['--prompt', 'Analyze the attached content using the instructions from stdin.', '--model', input.model,
    '--output-format', 'stream-json', '--extensions', 'none'], stdin,
    env: { GEMINI_CLI_SYSTEM_SETTINGS_PATH: settingsFile } }
}

export async function runToolVision(tool: MagicPenTool, input: CodexVisionInput, options: Options = {}): Promise<string> {
  if (tool === 'codex') return runCodexVision(input, options)
  if (!isCaptureCodexModel(input.model)) throw new CodexVisionError('failed')
  input.signal.throwIfAborted()
  let launch: AiToolLaunch
  try { launch = options.launch ?? findAiToolLaunch(tool) }
  catch { throw new CodexVisionError('cli_missing') }
  const request = await toolRequest(tool, input)
  input.signal.throwIfAborted()
  return new Promise<string>((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams
    try { child = (options.spawn ?? spawn)(launch.command, [...launch.prefix, ...request.args], {
      cwd: input.directory, env: { ...launch.env, ...request.env }, shell: false, windowsHide: true,
    }) as ChildProcessWithoutNullStreams } catch { reject(new CodexVisionError('cli_missing')); return }
    let pending = '', bytes = 0, answer = '', diagnostics = '', finished = false, failed = false, stopped = false, timedOut = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const stop = () => {
      if (stopped) return
      stopped = true
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' })
        killer.on('error', () => child.kill())
      } else child.kill()
      killTimer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL') }, 1500)
      killTimer.unref()
    }
    const timeout = setTimeout(() => { timedOut = true; stop() }, options.timeoutMs ?? 180_000)
    input.signal.addEventListener('abort', stop, { once: true })
    const cleanup = () => { clearTimeout(timeout); if (killTimer) clearTimeout(killTimer); input.signal.removeEventListener('abort', stop) }
    const line = (text: string) => {
      let event: any
      try { event = JSON.parse(text) } catch { return }
      // This is an explanation task. Never approve agent actions or follow a
      // tool call into the host. CLI-side deny policies are the first boundary.
      if (event.type === 'tool_use' || event.type === 'control_request' || event.message?.content?.some?.((part: any) => part.type === 'tool_use')) { failed = true; stop(); return }
      if (event.type === 'error' || event.is_error || event.subtype === 'vision_bridge_failed') { failed = true; diagnostics += JSON.stringify(event).slice(0, 3000) }
      if (event.type === 'assistant') {
        const text = event.message?.content?.filter?.((part: any) => part.type === 'text').map((part: any) => part.text).join('')
        if (typeof text === 'string' && text) { answer = text.slice(0, 100_000); input.onText(answer) }
      }
      if (tool === 'gemini-cli' && event.type === 'message' && event.role === 'assistant' && typeof event.content === 'string') {
        answer = (event.delta ? answer + event.content : event.content).slice(0, 100_000); input.onText(answer)
      }
      if (event.type === 'result') {
        finished = tool === 'gemini-cli' ? event.status === 'success' : event.subtype === 'success' && !event.is_error
        if (!finished) { failed = true; diagnostics += JSON.stringify(event).slice(0, 3000) }
        if (finished && typeof event.result === 'string') answer = event.result.slice(0, 100_000)
      }
    }
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk)
      if (bytes > 4_000_000) { failed = true; stop(); return }
      pending += chunk
      let index: number
      while ((index = pending.indexOf('\n')) >= 0) { line(pending.slice(0, index)); pending = pending.slice(index + 1) }
    })
    child.stderr.on('data', (chunk: string) => { diagnostics = (diagnostics + chunk).slice(-12_000) })
    child.stdin.on('error', () => {})
    child.stdin.end(request.stdin)
    child.once('error', () => { cleanup(); reject(new CodexVisionError('cli_missing')) })
    child.once('close', code => {
      cleanup(); if (pending) line(pending)
      if (input.signal.aborted) { reject(input.signal.reason); return }
      if (timedOut) { reject(new CodexVisionError('timeout')); return }
      if (code !== 0 || stopped || failed || !finished || !answer.trim()) {
        const error = /not (?:logged|signed) in|login required|please.*(?:log ?in|sign ?in|authenticate)|unauthorized|401|token.*expired|authentication|auth.*(?:required|method)|credentials.*(?:missing|not found|not configured)/i.test(diagnostics) ? 'login_required'
          : /unknown (?:argument|option)|unrecognized (?:argument|option)|invalid option/i.test(diagnostics) ? 'cli_update' : 'failed'
        reject(new CodexVisionError(error)); return
      }
      resolve(answer.trim())
    })
  })
}
