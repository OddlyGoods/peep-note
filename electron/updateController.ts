import type { UpdateState } from '../shared/updates'

export type UpdateEvent = 'update-available' | 'update-not-available' | 'download-progress' | 'update-downloaded' | 'error'
interface UpdateBackend {
  on: (event: UpdateEvent, listener: (...args: any[]) => void) => unknown
  checkForUpdates: () => Promise<unknown>
  downloadUpdate: () => Promise<unknown>
  quitAndInstall: (silent?: boolean, forceRunAfter?: boolean) => void | Promise<void>
}

// The main process owns the state, including failures, across renderer navigation.
export class UpdateController {
  private state: UpdateState

  constructor(private backend: UpdateBackend, currentVersion: string, platform: string,
    supported: boolean, private publish: (state: UpdateState) => void) {
    this.state = {
      revision: 0, status: supported ? 'idle' : 'unsupported', currentVersion,
      version: null, percent: 0, downloaded: false, checkedAt: null, error: null, platform
    }
    backend.on('update-available', info => this.change({ status: 'available', version: info.version, error: null }))
    backend.on('update-not-available', () => this.change({ status: 'up-to-date', version: null, checkedAt: Date.now(), error: null }))
    backend.on('download-progress', progress => this.change({ status: 'downloading', percent: Math.max(0, Math.min(100, progress.percent || 0)) }))
    backend.on('update-downloaded', info => this.change({ status: 'downloaded', version: info.version, percent: 100, downloaded: true, error: null }))
    backend.on('error', error => this.fail(error))
  }

  snapshot(): UpdateState { return { ...this.state } }

  private change(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 }
    this.publish(this.snapshot())
  }

  private fail(error: unknown) {
    this.change({ status: 'error', error: error instanceof Error ? error.message : String(error) })
  }

  async check() {
    if (['unsupported', 'checking', 'downloading', 'downloaded', 'installing'].includes(this.state.status) || this.state.downloaded) return this.snapshot()
    this.change({ status: 'checking', error: null, percent: 0 })
    try {
      await this.backend.checkForUpdates()
      if (this.state.status !== 'error') this.change({ checkedAt: Date.now() })
    } catch (error) { this.fail(error) }
    return this.snapshot()
  }

  async download() {
    if (!this.state.version || this.state.downloaded || !['available', 'error'].includes(this.state.status)) return this.snapshot()
    this.change({ status: 'downloading', percent: 0, error: null })
    try { await this.backend.downloadUpdate() } catch (error) { this.fail(error) }
    return this.snapshot()
  }

  async install() {
    if (!this.state.downloaded || !['downloaded', 'error'].includes(this.state.status)) return this.snapshot()
    this.change({ status: 'installing', error: null })
    // Keep windows alive until the updater actually starts quitting. An elevation
    // cancellation emits an error and must leave a usable app for another attempt.
    try { await this.backend.quitAndInstall(false, true) } catch (error) { this.fail(error) }
    return this.snapshot()
  }
}
