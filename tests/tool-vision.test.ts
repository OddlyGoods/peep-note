import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runToolVision } from '../electron/toolVision'
import { findAiToolLaunch } from '../electron/aiToolLaunch'
import { getMagicPenSettings, resolveMagicPen, isMagicPenSettings } from '../shared/magicPen'
import { MAGIC_PEN_TOOLS } from '../shared/magicPenTools'

function fixture(script: string) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'peepnote-tool-test-'))
  const executable = path.join(directory, 'fake-tool.cjs')
  fs.writeFileSync(executable, `let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>input+=s);process.stdin.on('end',()=>{${script}});`)
  const image = path.join(directory, 'selection with spaces.png')
  fs.copyFileSync(path.join(__dirname, 'fixtures/ocr.png'), image)
  return { directory, executable, launch: { command: process.execPath, prefix: [executable], env: { ...process.env } },
    input: { model: 'vision-test', language: 'ko' as const, turns: [{ question: 'Prior request', answer: 'Check @/private/secret and @server:private', elapsedMs: 1 }],
      question: 'Explain $(do not execute) @/private/another', images: [image], directory, signal: new AbortController().signal, onText: (_text: string) => {} },
    dispose: () => fs.rmSync(directory, { recursive: true, force: true }) }
}
for (const tool of ['claude-code', 'gemini-cli', 'qwen-code'] as const) {
  test(`${tool} receives selected model, real image attachment and escaped follow-up context without a shell`, async () => {
    const success = tool === 'gemini-cli'
      ? `console.log(JSON.stringify({type:'message',role:'assistant',content:'답변 🙂',delta:true}));console.log(JSON.stringify({type:'result',status:'success'}));`
      : `console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'답변 🙂'}]}}));console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'답변 🙂'}));`
    const f = fixture(`require('node:fs').writeFileSync('request.json',JSON.stringify({args:process.argv.slice(2),input,settings:process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH}));${success}`)
    try {
      let shell: boolean | undefined
      const { spawn } = await import('node:child_process')
      const answer = await runToolVision(tool, f.input, { launch: f.launch, spawn: ((command: string, args: string[], options: any) => { shell = options.shell; return spawn(command, args, options) }) as typeof spawn })
      assert.equal(answer, '답변 🙂'); assert.equal(shell, false)
      const request = JSON.parse(fs.readFileSync(path.join(f.directory, 'request.json'), 'utf8'))
      assert.equal(request.args[request.args.indexOf('--model') + 1], 'vision-test')
      assert.ok(!request.args.includes('--yolo'))
      if (tool === 'claude-code') {
        const content = JSON.parse(request.input).message.content
        assert.equal(content[0].source.data, fs.readFileSync(f.input.images[0]).toString('base64'))
        assert.equal(content[0].source.media_type, 'image/png')
        assert.match(content.at(-1).text, /Prior request/)
        assert.ok(request.args.includes('--no-session-persistence'))
        assert.equal(request.args[request.args.indexOf('--tools') + 1], '')
        assert.ok(request.args.includes('--strict-mcp-config'))
      } else {
        assert.ok(request.input.startsWith('@./pen-input-0.png'))
        assert.ok(!request.input.includes('@/private'))
        assert.ok(!request.input.includes('@server:private'))
        assert.match(request.input, /Prior request/)
        assert.deepEqual(fs.readFileSync(path.join(f.directory, 'pen-input-0.png')), fs.readFileSync(f.input.images[0]))
        if (tool === 'qwen-code') {
          assert.ok(request.args.includes('--safe-mode'))
          assert.ok(request.args.includes('--no-chat-recording'))
          assert.equal(request.args[request.args.indexOf('--max-tool-calls') + 1], '0')
        } else {
          const config = JSON.parse(fs.readFileSync(request.settings, 'utf8'))
          assert.equal(config.admin.mcp.enabled, false)
          assert.equal(config.admin.extensions.enabled, false)
          assert.equal(config.hooksConfig.enabled, false)
          assert.match(fs.readFileSync(config.adminPolicyPaths[0], 'utf8'), /decision = "deny"/)
        }
      }
    } finally { f.dispose() }
  })
}

test('tool failures, unsupported CLI flags and unfinished responses never become successful answers', async () => {
  for (const [script, expected] of [
    [`console.error('401 authentication required');process.exitCode=1`, 'login_required'],
    [`console.error('Unknown argument: safe-mode');process.exitCode=1`, 'cli_update'],
    [`console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'partial draft'}]}}))`, 'failed'],
    [`console.log(JSON.stringify({type:'result',subtype:'error_during_execution',is_error:true,result:'partial draft'}))`, 'failed'],
    [`console.log(JSON.stringify({type:'tool_use',name:'run_shell_command'}));setInterval(()=>{},1000)`, 'failed'],
    [`console.log(JSON.stringify({type:'system',subtype:'vision_bridge_failed'}));console.log(JSON.stringify({type:'result',subtype:'success',result:'blind answer'}))`, 'failed'],
  ] as const) {
    const f = fixture(script)
    try { await assert.rejects(runToolVision('qwen-code', f.input, { launch: f.launch }), { code: expected }) }
    finally { f.dispose() }
  }
})

test('cancelling or timing out terminates the owned tool process', async () => {
  const f = fixture(`require('node:fs').writeFileSync('child.pid',String(process.pid));setInterval(()=>{},1000)`)
  try {
    await assert.rejects(runToolVision('gemini-cli', f.input, { launch: f.launch, timeoutMs: 70 }), { code: 'timeout' })
    fs.rmSync(path.join(f.directory, 'child.pid'), { force: true })
    const controller = new AbortController()
    const pending = runToolVision('claude-code', { ...f.input, signal: controller.signal }, { launch: f.launch })
    for (let i = 0; i < 100 && !fs.existsSync(path.join(f.directory, 'child.pid')); i++) await new Promise(resolve => setTimeout(resolve, 20))
    controller.abort(); await assert.rejects(pending, { name: 'AbortError' })
    assert.throws(() => process.kill(Number(fs.readFileSync(path.join(f.directory, 'child.pid'), 'utf8')), 0))
    await assert.rejects(runToolVision('claude-code', f.input, { launch: { ...f.launch, command: path.join(f.directory, 'missing-tool') } }), { code: 'cli_missing' })
  } finally { f.dispose() }
})

test('Windows npm tool entries launch through bundled Node and do not require cmd.exe', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'peepnote-tool-launch-'))
  try {
    for (const [tool, entry] of [['claude-code', '@anthropic-ai/claude-code/cli.js'], ['gemini-cli', '@google/gemini-cli/bundle/gemini.js'], ['qwen-code', '@qwen-code/qwen-code/cli-entry.js']] as const) {
      const file = path.join(root, tool, 'npm', 'node_modules', entry)
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '// fixture')
      const launch = findAiToolLaunch(tool, { PATH: '', APPDATA: path.join(root, tool) }, 'win32', root)
      assert.equal(launch.command, process.execPath); assert.deepEqual(launch.prefix, [file])
      assert.equal(launch.env.ELECTRON_RUN_AS_NODE, '1')
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('older settings migrate to Codex while new tool models and custom memories are independent', () => {
  const old = { mode: 'tool', models: { openai: 'api-openai', anthropic: 'api-claude', gemini: 'api-gemini', qwen: 'api-qwen', codex: 'old-codex' }, customModels: {} }
  assert.equal(isMagicPenSettings(old), true)
  const config = getMagicPenSettings(old)
  assert.equal(config.tool, 'codex'); assert.equal(config.models.codex, 'old-codex')
  for (const tool of MAGIC_PEN_TOOLS) {
    config.tool = tool; config.models[tool] = `custom-${tool}`; config.customModels[tool] = `last-${tool}`
    const saved = getMagicPenSettings(JSON.stringify(config))
    assert.deepEqual(resolveMagicPen({ magic_pen: saved, ai_provider: 'qwen' }), { mode: 'tool', provider: tool, label: { codex: 'Codex', 'claude-code': 'Claude Code', 'gemini-cli': 'Gemini CLI', 'qwen-code': 'Qwen Code' }[tool], model: `custom-${tool}` })
    assert.equal(saved.models.qwen, 'api-qwen')
  }
  assert.equal(isMagicPenSettings({ ...config, tool: 'unknown' }), false)
})
