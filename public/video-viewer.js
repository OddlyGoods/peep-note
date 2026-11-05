const query = new URLSearchParams(location.search)
const language = query.get('language')
const messages = {
  en: { title: 'Video', minimize: 'Minimize', maximize: 'Maximize', restore: 'Restore', close: 'Close', error: 'Could not play this video.' },
  ko: { title: '동영상', minimize: '최소화', maximize: '최대화', restore: '이전 크기로', close: '닫기', error: '동영상을 재생하지 못했습니다.' },
  ja: { title: '動画', minimize: '最小化', maximize: '最大化', restore: '元に戻す', close: '閉じる', error: '動画を再生できませんでした。' },
  zh: { title: '视频', minimize: '最小化', maximize: '最大化', restore: '还原', close: '关闭', error: '无法播放此视频。' },
}
const copy = messages[language] || messages.en
const player = document.getElementById('player'), error = document.getElementById('error')
const api = window.electronAPI
const applyTheme = theme => { document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light' }
applyTheme(query.get('theme'))
document.documentElement.lang = messages[language] ? language : 'en'
for (const action of ['minimize', 'maximize', 'close']) {
  const button = document.getElementById(action)
  button.title = copy[action]; button.setAttribute('aria-label', copy[action])
  button.onclick = () => api.imageViewerControl(action)
}
api.on('image-viewer-maximized', maximized => {
  const button = document.getElementById('maximize')
  button.textContent = maximized ? '❐' : '□'
  button.title = maximized ? copy.restore : copy.maximize
  button.setAttribute('aria-label', button.title)
})
api.on('theme-changed', applyTheme)
player.addEventListener('error', () => { error.textContent = copy.error; error.hidden = false })
try {
  const source = new URL(query.get('source'))
  if (source.protocol !== 'file:') throw new Error('Invalid video source')
  const filename = decodeURIComponent(source.pathname.split('/').pop())
  document.getElementById('filename').textContent = filename
  document.title = `${filename} — ${copy.title}`
  player.setAttribute('aria-label', copy.title)
  player.src = source.href
} catch { error.textContent = copy.error; error.hidden = false }
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !document.fullscreenElement) api.imageViewerControl('close') })
window.addEventListener('pagehide', () => player.pause())
