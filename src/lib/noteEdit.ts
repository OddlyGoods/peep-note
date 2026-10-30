import type { Log } from './api'

export type NoteForm = Pick<Log, 'title' | 'content' | 'tags' | 'content_format' | 'is_secret'>
export const noteForm = (log: Log): NoteForm => ({
  title: log.title, content: log.content, tags: [...log.tags], content_format: log.content_format ?? 'text', is_secret: !!log.is_secret
})

export function hasNoteChanges(log: Log, form: NoteForm, attachments: string[]) {
  const original = noteForm(log)
  return form.title !== original.title || form.content !== original.content || form.content_format !== original.content_format
    || form.is_secret !== original.is_secret || JSON.stringify(form.tags) !== JSON.stringify(original.tags)
    || JSON.stringify(attachments) !== JSON.stringify(log.attachments)
}
