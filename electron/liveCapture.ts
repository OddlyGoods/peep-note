// A live selector must disappear before the first desktop capture. Keep this
// sequencing separate so cancellation cannot deliver a late screenshot.
export function createLiveCapture(options: {
  hide: () => void
  capture: () => Promise<string>
  deliver: (dataUrl: string) => void
  onError: (error: unknown) => void
  wait?: () => Promise<void>
}) {
  let active = true, pending = false
  return {
    get pending() { return pending },
    dispose() { active = false },
    async start() {
      if (!active || pending) return
      pending = true
      try {
        options.hide()
        await (options.wait?.() ?? new Promise(resolve => setTimeout(resolve, 150)))
        if (!active) return
        const dataUrl = await options.capture()
        if (active) options.deliver(dataUrl)
      } catch (error) { if (active) options.onError(error) }
    },
  }
}
