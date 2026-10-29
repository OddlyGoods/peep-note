export type MenuPath = '/' | '/search' | '/favorites' | '/trash' | '/settings'
export type ScreenKey = 'explore-list' | 'explore-detail' | 'search-list' | 'search-detail' | 'favorites-list' | 'favorites-detail' | 'trash' | 'settings'

export function screenForPath(pathname: string): ScreenKey | null {
  pathname = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname
  if (pathname === '/') return 'explore-list'
  if (/^\/log\/[^/]+\/?$/.test(pathname)) return 'explore-detail'
  if (pathname === '/search') return 'search-list'
  if (/^\/search\/log\/[^/]+\/?$/.test(pathname)) return 'search-detail'
  if (pathname === '/favorites') return 'favorites-list'
  if (/^\/favorites\/log\/[^/]+\/?$/.test(pathname)) return 'favorites-detail'
  if (pathname === '/trash') return 'trash'
  if (pathname === '/settings') return 'settings'
  return null
}

export function menuForPath(pathname: string): MenuPath | null {
  const screen = screenForPath(pathname)
  if (!screen) return null
  if (screen.startsWith('explore-')) return '/'
  if (screen.startsWith('search-')) return '/search'
  if (screen.startsWith('favorites-')) return '/favorites'
  return screen === 'trash' ? '/trash' : '/settings'
}
