export function hasActiveSecretUnlock() {
  return Number(sessionStorage.getItem('openpeepnote_secret_unlock_until') ?? 0) > Date.now()
}

export function rememberSecretUnlock() {
  sessionStorage.setItem('openpeepnote_secret_unlock_until', String(Date.now() + 60_000))
}
