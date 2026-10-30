export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error'

// Serialize writes so a slower response cannot overwrite a newer setting.
export function createSettingsAutosave<T extends object>(
  persist: (patch: Partial<T>) => Promise<void>,
  onStatus: (status: AutosaveStatus) => void,
) {
  const pending = new Map<keyof T, { value: T[keyof T]; due: number }>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<void> | undefined
  let failed = false

  function arm() {
    clearTimeout(timer)
    if (running || failed || !pending.size) return
    const due = Math.min(...Array.from(pending.values(), item => item.due))
    timer = setTimeout(() => { void run() }, Math.max(0, due - Date.now()))
  }

  function run(): Promise<void> {
    if (running) return running
    const batch = Array.from(pending).filter(([, item]) => item.due <= Date.now())
    if (!batch.length) { arm(); return Promise.resolve() }
    for (const [key] of batch) pending.delete(key)
    onStatus('saving')
    running = Promise.resolve().then(() => persist(Object.fromEntries(batch.map(([key, item]) => [key, item.value])) as Partial<T>))
      .then(() => { failed = false })
      .catch(() => {
        // Keep failed changes for retry, without replacing edits made meanwhile.
        for (const [key, item] of batch) if (!pending.has(key)) pending.set(key, item)
        failed = true
      })
      .finally(() => {
        running = undefined
        onStatus(failed ? 'error' : pending.size ? 'saving' : 'saved')
        arm()
      })
    return running
  }

  return {
    schedule(patch: Partial<T>, delay = 0) {
      for (const key of Object.keys(patch) as (keyof T)[]) {
        pending.set(key, { value: patch[key] as T[keyof T], due: Date.now() + delay })
      }
      failed = false
      onStatus('saving')
      arm()
    },
    cancel(keys: (keyof T)[]) {
      for (const key of keys) pending.delete(key)
      if (!running && !pending.size) { clearTimeout(timer); failed = false; onStatus('idle') }
      else arm()
    },
    async flush(): Promise<boolean> {
      clearTimeout(timer)
      if (running) await running
      failed = false
      for (const item of pending.values()) item.due = 0
      await run()
      if (failed) return false
      if (pending.size) return this.flush()
      return true
    },
  }
}
