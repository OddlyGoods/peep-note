import type { AiResponseLanguage } from '../shared/aiResponseLanguage'
import { ApiVisionError } from './apiVision'
import { ProgressiveText } from './progressiveText'
import { BrowserWindow, screen, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { protectAppNavigation } from './appNavigation'
import { runCodexVision, CodexVisionError, type CodexVisionInput } from './codexVision'
import { analysisWindowBounds, captureAnalysisCopy, splitCaptureResponse, type CaptureAnalysisState, type CaptureLanguage, type CaptureTurn } from '../shared/captureAnalysis'

export type AnalysisCapture = { filePath: string; bounds: { x: number; y: number; width: number; height: number } }
export interface AnalysisWindowOptions {
  firstCapture: AnalysisCapture
  directory: string
  language: CaptureLanguage
  responseLanguage?: AiResponseLanguage
  model: string
  provider?: string
  theme: 'dark' | 'light'
  dev: boolean
  capture: () => Promise<AnalysisCapture | null>
  workspaces: CaptureAnalysisState['workspaces']
  save: (turns: CaptureTurn[], workspaceId: string | null) => string
  analyze?: (input: CodexVisionInput) => Promise<string>
  onClosed: () => void
}

export class CaptureAnalysisWindow {
  readonly window: BrowserWindow
  private value: CaptureAnalysisState
  private images: string[] = []
  private controller: AbortController | null = null
  private disposed = false
  private busyCapture = false
  private interruptedTurn: CaptureTurn | null = null

  constructor(private options: AnalysisWindowOptions) {
    this.value = { status: 'waiting', maximized: false, language: options.language, model: options.model, provider: options.provider ?? 'Codex', turns: [], question: '', draft: '', startedAt: null,
      error: null, capturing: false, saving: false, saved: false,
      workspaceId: options.workspaces.find(item => item.isDefault)?.id ?? null, workspaces: options.workspaces }
    const workArea = screen.getDisplayMatching(options.firstCapture.bounds).workArea
    this.window = new BrowserWindow({ ...analysisWindowBounds(options.firstCapture.bounds, workArea),
      minWidth: Math.min(360, workArea.width), minHeight: Math.min(280, workArea.height),
      title: `PeepNote · ${captureAnalysisCopy[options.language].title}`, frame: false, alwaysOnTop: true, resizable: true, show: false,
      transparent: true, backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'captureAnalysisPreload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    protectAppNavigation(this.window.webContents, url => shell.openExternal(url))
    this.window.once('ready-to-show', () => { if (!this.disposed) { this.window.show(); this.window.focus() } })
    this.window.once('closed', () => this.dispose())
    this.window.on('maximize', () => this.publish({ maximized: true }))
    this.window.on('unmaximize', () => this.publish({ maximized: false }))
    const query = `?language=${options.language}&theme=${options.theme}`
    void this.window.loadURL(options.dev ? `http://localhost:5173/capture-analysis.html${query}` : `app://dist/capture-analysis.html${query}`)
    this.addImage(options.firstCapture.filePath)
    void this.run(captureAnalysisCopy[options.language].initial)
  }

  get state(): CaptureAnalysisState { return this.value }
  get isBusy() { return this.value.status === 'running' || this.value.status === 'stopping' || this.busyCapture }
  private publish(patch: Partial<CaptureAnalysisState>) {
    if (this.disposed) return
    this.value = { ...this.value, ...patch }
    if (!this.window.isDestroyed()) this.window.webContents.send('capture-analysis-state', this.value)
  }
  private addImage(file: string) {
    this.images.push(file)
  }
  private async run(question: string) {
    if (this.disposed || this.isBusy) return
    const textLength = this.value.turns.reduce((sum, turn) => sum + turn.question.length + turn.answer.length, question.length)
    if (textLength > 80_000 || this.images.length > 6 || this.value.turns.length >= 16) {
      this.publish({ error: 'context_limit', status: 'error' }); return
    }
    this.interruptedTurn = null
    const controller = this.controller = new AbortController(), startedAt = Date.now()
    const stream = new ProgressiveText(controller.signal, draft => this.publish({ draft }))
    this.publish({ status: 'running', question, startedAt, error: null, draft: '' })
    try {
      const answer = await (this.options.analyze ?? runCodexVision)({ responseLanguage: this.options.responseLanguage, model: this.value.model, language: this.value.language, turns: this.value.turns,
        question, images: [...this.images], directory: this.options.directory, signal: controller.signal,
        onText: draft => stream.update(draft) })
      if (controller.signal.aborted || this.disposed) return
      const elapsedMs = Date.now() - startedAt
      await stream.finish(answer)
      if (controller.signal.aborted || this.disposed) return
      const response = splitCaptureResponse(answer)
      this.publish({ status: 'ready', draft: '', saved: false,
        turns: [...this.value.turns, { question, answer: response.body, title: response.title, elapsedMs, imageCount: this.images.length, model: this.value.model, provider: this.value.provider }] })
    } catch (error) {
      if (!controller.signal.aborted && !this.disposed) this.publish({ status: 'error', draft: '',
        error: error instanceof CodexVisionError || error instanceof ApiVisionError ? error.code : 'failed' })
    } finally {
      stream.dispose()
      if (this.controller === controller) {
        this.controller = null
        if (this.value.status === 'stopping') this.publish({ status: 'stopped' })
      }
    }
  }
  stop() {
    if (this.disposed || this.value.status !== 'running' || !this.controller) return
    const response = splitCaptureResponse(this.value.draft)
    this.interruptedTurn = response.body.trim() ? { question: this.value.question, answer: response.body, title: response.title,
      interrupted: true, elapsedMs: Math.max(0, Date.now() - (this.value.startedAt ?? Date.now())), imageCount: this.images.length,
      model: this.value.model, provider: this.value.provider } : null
    this.publish({ status: 'stopping', draft: '', error: null, saved: false,
      turns: this.interruptedTurn ? [...this.value.turns, this.interruptedTurn] : this.value.turns })
    this.controller.abort()
  }
  async retry() {
    if (this.isBusy || !['error', 'stopped'].includes(this.value.status) || this.value.error === 'context_limit') return
    if (this.interruptedTurn) this.publish({ turns: this.value.turns.filter(turn => turn !== this.interruptedTurn) })
    await this.run(this.value.question)
  }
  async ask(question: unknown) {
    if (this.isBusy || !['ready', 'stopped'].includes(this.value.status) || typeof question !== 'string' || !question.trim()) return
    await this.run(question.trim().slice(0, 4000))
  }
  async capture(question: unknown) {
    if (this.disposed || this.isBusy || !['ready', 'stopped'].includes(this.value.status)) return
    if (this.images.length >= 6) { this.publish({ error: 'context_limit', status: 'error' }); return }
    this.busyCapture = true
    this.publish({ capturing: true })
    this.window.hide()
    try {
      const capture = await this.options.capture()
      if (this.disposed) return
      if (capture) {
        this.addImage(capture.filePath)
        // Keep the dragged response window in place; only the initial capture determines its position.
        this.busyCapture = false
        this.publish({ capturing: false })
        this.window.show()
        this.window.focus()
        await this.run(typeof question === 'string' && question.trim() ? question.trim().slice(0, 4000) : captureAnalysisCopy[this.value.language].next)
      }
    } catch {
      this.publish({ error: 'failed', status: 'error' })
    } finally {
      this.busyCapture = false
      if (this.disposed) this.cleanFiles()
      else { this.publish({ capturing: false }); this.window.show(); this.window.focus() }
    }
  }
  async save(workspaceId: unknown): Promise<boolean> {
    if (this.disposed || this.isBusy || !this.value.turns.length || this.value.saving) return false
    if (this.value.saved) return true
    const id = typeof workspaceId === 'string' && this.value.workspaces.some(item => item.id === workspaceId) ? workspaceId : this.value.workspaceId
    this.publish({ saving: true })
    try {
      this.options.save(this.value.turns, id)
      this.publish({ saved: true, workspaceId: id })
      return true
    } catch { return false }
    finally { this.publish({ saving: false }) }
  }
  maximize() { if (!this.window.isDestroyed()) { if (this.window.isMaximized()) this.window.unmaximize(); else this.window.maximize() } }
  close() { if (!this.window.isDestroyed()) this.window.close(); else this.dispose() }
  private cleanFiles() { try { fs.rmSync(this.options.directory, { recursive: true, force: true }) } catch {} }
  private dispose() {
    if (this.disposed) return
    this.disposed = true
    const pending = this.controller
    pending?.abort()
    // On POSIX the CLI forwards SIGTERM; remove temp files once its exit has
    // settled. Captures clean up after their own asynchronous completion.
    if (!this.busyCapture) {
      if (pending) setTimeout(() => this.cleanFiles(), 2500).unref()
      else this.cleanFiles()
    }
    this.options.onClosed()
  }
}
