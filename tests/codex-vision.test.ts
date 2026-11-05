import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runCodexVision, CodexVisionError } from '../electron/codexVision'
import { capturePrompt, captureNoteMarkdown, splitCaptureResponse, analysisWindowBounds, type CaptureTurn } from '../shared/captureAnalysis'

const previous: CaptureTurn[] = [{ question: 'What failed?', answer: 'Capture the full error message.', elapsedMs: 1000 }]

function fixture(script: string) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'peepnote-vision-test-'))
  const executable = path.join(directory, 'fake-codex.cjs')
  fs.writeFileSync(executable, script)
  return { directory, launch: { command: process.execPath, prefix: [executable], env: { ...process.env } },
    dispose: () => fs.rmSync(directory, { recursive: true, force: true }) }
}

test('vision CLI receives images, prior conversation and explicit stateless, isolated options without a shell', async () => {
  const f = fixture(`const fs=require('node:fs');let prompt='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>prompt+=s);process.stdin.on('end',()=>{fs.writeFileSync('request.json',JSON.stringify({args:process.argv.slice(2),prompt}));const e=JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'한글 답변 🙂'}})+'\\n';const b=Buffer.from(e),i=b.indexOf(Buffer.from('한'))+1;process.stdout.write(b.subarray(0,i));setTimeout(()=>{process.stdout.write(b.subarray(i));},15)});`)
  try {
    const updates: string[] = []
    const question = 'Explain this `$(do not execute)` and "quoted" error.'
    const result = await runCodexVision({ model: 'gpt-6.1-sol', language: 'ko', turns: previous, question, images: ['/example/first capture.png', '/example/second.png'],
      directory: f.directory, signal: new AbortController().signal, onText: text => updates.push(text) }, { launch: f.launch })
    assert.equal(result, '한글 답변 🙂')
    assert.deepEqual(updates, ['한글 답변 🙂'])
    const request = JSON.parse(fs.readFileSync(path.join(f.directory, 'request.json'), 'utf8'))
    assert.ok(request.args.includes('--ephemeral'))
    assert.ok(request.args.includes('--ignore-user-config'))
    assert.equal(request.args[request.args.indexOf('--model') + 1], 'gpt-6.1-sol')
    assert.ok(request.args.includes('read-only'))
    assert.equal(request.args.at(-1), '-')
    const images = request.args.flatMap((item: string, index: number) => item === '--image' ? [request.args[index + 1]] : [])
    assert.deepEqual(images, ['/example/first capture.png', '/example/second.png'])
    assert.ok(request.prompt.includes(JSON.stringify(question)))
    assert.ok(request.prompt.includes(previous[0].answer))
    assert.match(request.prompt, /may save your answer as a note in PeepNote/)
    assert.ok(request.prompt.includes('Reply in Korean'))
    assert.equal(fs.existsSync(path.join(f.directory, 'answer.md')), false)
  } finally { f.dispose() }
})

test('a successful final output file is used while failed/partial responses are never treated as success', async () => {
  const f = fixture(`const fs=require('node:fs'),args=process.argv;process.stdin.resume();process.stdin.on('end',()=>{fs.writeFileSync(args[args.indexOf('--output-last-message')+1],'## Final answer');console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'draft'}}))});`)
  try {
    assert.equal(await runCodexVision({ model: 'gpt-6.1-sol', language: 'en', turns: [], question: 'Explain', images: [], directory: f.directory,
      signal: new AbortController().signal, onText: () => {} }, { launch: f.launch }), '## Final answer')
    fs.writeFileSync(f.launch.prefix[0], `process.stdin.resume();process.stdin.on('end',()=>{console.log(JSON.stringify({type:'turn.failed',error:{message:'401 Unauthorized'}}));process.exitCode=1});`)
    await assert.rejects(runCodexVision({ model: 'gpt-6.1-sol', language: 'en', turns: [], question: 'Explain', images: [], directory: f.directory,
      signal: new AbortController().signal, onText: () => {} }, { launch: f.launch }), (error: unknown) => error instanceof CodexVisionError && error.code === 'login_required')
    assert.equal(fs.existsSync(path.join(f.directory, 'answer.md')), false, 'the previous successful answer must be removed before retry')
  } finally { f.dispose() }
})

test('closing or timing out cancels the child process and rejects without a completed answer', async () => {
  const f = fixture(`require('node:fs').writeFileSync('child.pid',String(process.pid));process.stdin.resume();setInterval(()=>{},1000)`)
  const input = { model: 'gpt-6-luna', language: 'en' as const, turns: [], question: 'Explain', images: [], directory: f.directory, onText: () => {} }
  try {
    await assert.rejects(runCodexVision({ ...input, signal: new AbortController().signal }, { launch: f.launch, timeoutMs: 80 }), (error: unknown) => error instanceof CodexVisionError && error.code === 'timeout')
    fs.rmSync(path.join(f.directory, 'child.pid'), { force: true })
    const controller = new AbortController()
    const pending = runCodexVision({ ...input, signal: controller.signal }, { launch: f.launch })
    for (let attempt = 0; attempt < 100 && !fs.existsSync(path.join(f.directory, 'child.pid')); attempt++) await new Promise(resolve => setTimeout(resolve, 20))
    controller.abort()
    await assert.rejects(pending, /cancelled/)
    const pid = Number(fs.readFileSync(path.join(f.directory, 'child.pid'), 'utf8'))
    assert.throws(() => process.kill(pid, 0))
  } finally { f.dispose() }
})

test('conversation export preserves follow-up questions and answers, and response windows stay on the captured display', () => {
  assert.match(captureNoteMarkdown([...previous, { question: 'More\ncontext', answer: 'Use this fix.', elapsedMs: 20 }]), /> More\n> context\n\nUse this fix\./)
  assert.ok(capturePrompt('ja', previous, 'Explain').includes('Japanese'))
  assert.deepEqual(analysisWindowBounds({ x: -20, y: 700 }, { x: -1024, y: 0, width: 1024, height: 768 }), { x: -480, y: 128, width: 480, height: 640 })
  assert.deepEqual(analysisWindowBounds({ x: 500, y: -50 }, { x: 0, y: 0, width: 320, height: 240 }), { x: 0, y: 0, width: 320, height: 240 })
})

test('Magic Pen restores saved dimensions within the current display and ignores invalid saved sizes', () => {
  const area = { x: -1024, y: 0, width: 1024, height: 768 }
  const anchor = { x: -20, y: 700 }
  assert.deepEqual(analysisWindowBounds(anchor, area, { width: 600, height: 720 }), { x: -600, y: 48, width: 600, height: 720 })
  assert.deepEqual(analysisWindowBounds(anchor, area, { width: 1800, height: 1200 }), { ...area })
  assert.deepEqual(analysisWindowBounds(anchor, area, { width: 1, height: 1 }), { x: -360, y: 488, width: 360, height: 280 })
  for (const saved of [null, {}, 'invalid', { width: NaN, height: Infinity }, { width: -10, height: '600' }]) {
    assert.deepEqual(analysisWindowBounds(anchor, area, saved), analysisWindowBounds(anchor, area))
  }
})

test('Codex capture catalog only offers visible image models and keeps their priority and stable IDs', async () => {
  const { parseCodexModelCatalog, normalizeCaptureCodexModel, isCaptureCodexModel, DEFAULT_CAPTURE_CODEX_MODEL } = await import('../shared/codexModels')
  const model = (slug: string, priority: number, extra = {}) => ({ slug, display_name: slug.toUpperCase(), visibility: 'list', input_modalities: ['text', 'image'], priority, ...extra })
  const choices = parseCodexModelCatalog({ models: [model('later', 8), model('hidden', 1, { visibility: 'hide' }), model('text-only', 2, { input_modalities: ['text'] }), model('first', 1), model('first', 2), model('invalid model', 0)] })
  assert.deepEqual(choices, [{ value: 'first', label: 'FIRST' }, { value: 'later', label: 'LATER' }])
  for (const value of [undefined, null, {}, { models: {} }]) assert.deepEqual(parseCodexModelCatalog(value), [])
  for (const value of ['', '--model', 'model with spaces', 'x\n--bad', 'x'.repeat(129)]) assert.equal(isCaptureCodexModel(value), false)
  assert.equal(normalizeCaptureCodexModel(' future-vision-model '), 'future-vision-model')
  assert.equal(normalizeCaptureCodexModel(null), DEFAULT_CAPTURE_CODEX_MODEL)
})


test('Magic Pen keeps the generated title separate from streamed and completed answer Markdown', () => {
  for (const chunk of ['#', '# ', '# 프로젝트 개', '# 프로젝트 개요\n']) assert.equal(splitCaptureResponse(chunk).body, '')
  const body = '## 핵심\n\n**내용**과 `code`를 그대로 보존합니다.\n'
  assert.deepEqual(splitCaptureResponse('\uFEFF\n# **프로젝트 개요**\n\n' + body), { title: '프로젝트 개요', body })
  for (const text of ['plain answer', '## Body heading\n\nContent', '```python\n# code comment\n```', '#hashtag']) {
    assert.deepEqual(splitCaptureResponse(text), { body: text })
  }
  assert.equal(splitCaptureResponse('# ' + 'x'.repeat(120) + '\n\nBody').title?.length, 100)
})
