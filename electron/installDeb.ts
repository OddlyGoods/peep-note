import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'

type CommandRunner = (command: string, args: string[], callback: (error: Error | null) => void) => unknown

export function installDeb(file: string | null, run: CommandRunner = execFile): Promise<void> {
  if (!file || !file.endsWith('.deb') || !fs.existsSync(file)) return Promise.reject(new Error('Downloaded package is unavailable'))
  // file is supplied only by electron-updater after checksum verification.
  // Arguments never pass through a shell. A cancelled Polkit prompt rejects.
  return new Promise((resolve, reject) => {
    run('pkexec', ['/usr/bin/dpkg', '--install', file], error => error ? reject(error) : resolve())
  })
}

type RelaunchApp = { relaunch: (options: { execPath: string; args: string[] }) => void; quit: () => void }

export function updatedDebExecutable(currentExecutable: string): string {
  const directory = path.dirname(currentExecutable)
  // Prefer the current package's canonical name. An older process may still
  // have the removed open-peep-note binary cached in process.execPath.
  for (const candidate of new Set([path.join(directory, 'peep-note'), currentExecutable, path.join(directory, 'open-peep-note')])) {
    try {
      if (!fs.statSync(candidate).isFile()) continue
      fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch { /* Try the next installed executable. */ }
  }
  throw new Error('The updated PeepNote executable is unavailable. Start the app from the application menu.')
}

export async function installDebAndRestart(file: string | null, app: RelaunchApp, currentExecutable: string, args: string[], run: CommandRunner = execFile) {
  await installDeb(file, run)
  // Resolve only after dpkg has completed: installation can replace or rename
  // the executable. A failure here leaves the app open to report the error.
  const executable = updatedDebExecutable(currentExecutable)
  app.relaunch({ execPath: executable, args })
  app.quit()
}
