import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { restartInstalledApp, type RelaunchApp } from './linuxRelaunch'
import { LINUX_UPDATE_RESTART_REQUIRED } from '../shared/updates'

export function linuxPrivilegeRestricted(read = () => fs.readFileSync('/proc/self/status', 'utf8')): boolean {
  try { return /^NoNewPrivs:\s*1\s*$/m.test(read()) } catch { return false }
}

type CommandRunner = (command: string, args: string[], callback: (error: Error | null) => void) => unknown

export function installDeb(file: string | null, run: CommandRunner = execFile, restricted = linuxPrivilegeRestricted): Promise<void> {
  if (!file || !file.endsWith('.deb') || !fs.existsSync(file)) return Promise.reject(new Error('Downloaded package is unavailable'))
  if (restricted()) return Promise.reject(new Error(LINUX_UPDATE_RESTART_REQUIRED))
  // file is supplied only by electron-updater after checksum verification.
  // Arguments never pass through a shell. A cancelled Polkit prompt rejects.
  return new Promise((resolve, reject) => {
    run('pkexec', ['/usr/bin/dpkg', '--install', file], error => error ? reject(error) : resolve())
  })
}

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

export async function installDebAndRestart(file: string | null, app: RelaunchApp, currentExecutable: string, args: string[], run: CommandRunner = execFile, restart = restartInstalledApp) {
  await installDeb(file, run)
  // Resolve only after dpkg has completed: installation can replace or rename
  // the executable. A failure here leaves the app open to report the error.
  const executable = updatedDebExecutable(currentExecutable)
  await restart(app, executable, args)
}
