// Coalesce token events before IPC/Markdown rendering. CLIs that only emit a
// completed message get the same short progressive reveal, without extra AI calls.
export class ProgressiveText {
  private target = ''
  private shown = ''
  private timer?: ReturnType<typeof setTimeout>
  private disposed = false
  private resolve?: () => void
  private reject?: (reason: unknown) => void
  private abort = () => this.dispose()

  constructor(private signal: AbortSignal, private publish: (text: string) => void) {
    signal.addEventListener('abort', this.abort, { once: true })
  }
  update(text: string) {
    if (this.disposed || this.signal.aborted) return
    this.target = text.trimStart()
    if (!this.target.startsWith(this.shown)) {
      // An authoritative final message can correct an earlier draft.
      this.shown = this.shown.startsWith(this.target) ? this.target : ''
      this.publish(this.shown)
    }
    if (!this.timer && this.target !== this.shown) this.timer = setTimeout(() => this.tick(), 24)
  }
  private tick() {
    this.timer = undefined
    if (this.disposed || this.signal.aborted) return
    let end = Math.min(this.target.length, this.shown.length + Math.max(2, Math.ceil(this.target.length / 28)))
    // Do not split a surrogate pair (emoji) between rendered frames.
    if (end < this.target.length && /[\uD800-\uDBFF]/.test(this.target[end - 1])) end++
    this.shown = this.target.slice(0, end)
    this.publish(this.shown)
    if (this.shown !== this.target) this.timer = setTimeout(() => this.tick(), 24)
    else { this.resolve?.(); this.resolve = undefined; this.reject = undefined }
  }
  async finish(text: string) {
    this.signal.throwIfAborted()
    this.update(text)
    if (this.shown === this.target) return
    await new Promise<void>((resolve, reject) => { this.resolve = resolve; this.reject = reject })
  }
  dispose() {
    this.disposed = true
    clearTimeout(this.timer)
    this.signal.removeEventListener('abort', this.abort)
    this.reject?.(this.signal.reason ?? new Error('cancelled'))
    this.resolve = undefined; this.reject = undefined
  }
}
