import type { WebContents } from 'electron'
import { externalWebUrl } from '../shared/noteLinks'

export function protectAppNavigation(contents: WebContents, openExternal: (url: string) => Promise<unknown>) {
  const openWeb = (url: unknown) => {
    const href = externalWebUrl(url)
    if (href) void Promise.resolve().then(() => openExternal(href)).catch(() => {})
  }
  // App routing uses history state; full document navigation must never replace it.
  contents.on('will-navigate', (event, url) => {
    event.preventDefault()
    openWeb(event.url ?? url)
  })
  contents.setWindowOpenHandler(({ url }) => {
    openWeb(url)
    return { action: 'deny' }
  })
}
