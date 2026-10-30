// Wait for an explicit save before cleaning its draft copies. The main process
// also refuses to remove files that have become referenced by saved data.
export function discardDraftFiles(files: string[], pending?: Promise<unknown> | null) {
  const clean = () => files.forEach(file => { void window.electronAPI?.deleteAttachmentFile(file).catch(() => {}) })
  if (pending) void pending.then(clean, clean)
  else clean()
}
