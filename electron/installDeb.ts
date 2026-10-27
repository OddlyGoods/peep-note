import { execFile } from 'child_process'
import fs from 'fs'

type CommandRunner = (command: string, args: string[], callback: (error: Error | null) => void) => unknown

export function installDeb(file: string | null, run: CommandRunner = execFile): Promise<void> {
  if (!file || !file.endsWith('.deb') || !fs.existsSync(file)) return Promise.reject(new Error('Downloaded package is unavailable'))
  // file is supplied only by electron-updater after checksum verification.
  // Arguments never pass through a shell. A cancelled Polkit prompt rejects.
  return new Promise((resolve, reject) => {
    run('pkexec', ['/usr/bin/dpkg', '--install', file], error => error ? reject(error) : resolve())
  })
}
