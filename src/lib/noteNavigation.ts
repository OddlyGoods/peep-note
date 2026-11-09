import { menuForPath, screenForPath, type MenuPath } from './menuMemory'

export type NoteReturnTarget = { pathname: MenuPath; search: string; hash: string }
type SourceLocation = { pathname: string; search: string; hash: string; state?: unknown }
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

export function savedNoteReturnTarget(state: unknown): NoteReturnTarget | null {
  const target = object(object(state).noteReturnTo)
  if (typeof target.pathname !== 'string' || menuForPath(target.pathname) !== target.pathname) return null
  return {
    pathname: target.pathname as MenuPath,
    search: typeof target.search === 'string' && target.search.startsWith('?') ? target.search : '',
    hash: typeof target.hash === 'string' && target.hash.startsWith('#') ? target.hash : '',
  }
}

export function noteBackTarget(pathname: string, state: unknown): NoteReturnTarget {
  return savedNoteReturnTarget(state) ?? { pathname: menuForPath(pathname) ?? '/', search: '', hash: '' }
}

export function noteNavigationState(source: SourceLocation, destination: string, state?: unknown) {
  const menu = menuForPath(source.pathname)
  // Following another note in a group keeps the original list/map as its origin.
  const target = screenForPath(source.pathname)?.endsWith('-detail')
    ? noteBackTarget(source.pathname, source.state)
    : { pathname: menu ?? menuForPath(destination) ?? '/', search: source.search, hash: source.hash }
  return { ...object(state), noteReturnTo: target }
}
