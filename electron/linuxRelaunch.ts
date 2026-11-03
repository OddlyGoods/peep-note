import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// Electron's Linux relauncher can add no_new_privs before exec. A normal
// child preserves the existing privilege state; it never clears restrictions.
// All variable data is passed as positional arguments, never shell source.
const helper = `
parent=$1
shift
[ -x "$1" ] || exit 1
printf 'ready\\n'
attempt=0
while kill -0 "$parent" 2>/dev/null; do
  [ "$attempt" -lt 300 ] || exit 1
  attempt=$((attempt + 1))
  /bin/sleep 0.1
done
exec "$@" </dev/null >/dev/null 2>&1
`

export function prepareLinuxRelaunch(executable: string, args: string[], start: typeof spawn = spawn): Promise<void> {
  if (!path.isAbsolute(executable)) return Promise.reject(new Error('Restart executable must be an absolute path'))
  try { fs.accessSync(executable, fs.constants.X_OK) } catch { return Promise.reject(new Error('Restart executable is unavailable')) }
  return new Promise((resolve, reject) => {
    const child = start('/bin/sh', ['-c', helper, 'peepnote-restart', String(process.pid), executable, ...args], {
      detached: true, stdio: ['ignore', 'pipe', 'ignore']
    })
    let settled = false, output = ''
    const timeout = setTimeout(() => fail(new Error('Restart helper did not become ready')), 5000)
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      child.stdout?.destroy()
      child.kill()
      reject(error)
    }
    child.once('error', fail)
    child.once('exit', () => fail(new Error('Restart helper exited before becoming ready')))
    child.stdout?.on('data', data => {
      output += String(data)
      if (settled || !output.includes('\n')) return
      if (output !== 'ready\n') return fail(new Error('Unexpected restart helper response'))
      settled = true
      clearTimeout(timeout)
      child.stdout?.destroy()
      child.unref()
      resolve()
    })
  })
}

export type RelaunchApp = { relaunch: (options: { execPath: string; args: string[] }) => void; quit: () => void }

export async function restartInstalledApp(app: RelaunchApp, executable: string, args: string[],
  platform: NodeJS.Platform = process.platform, prepare = prepareLinuxRelaunch) {
  if (platform === 'linux') await prepare(executable, args)
  else app.relaunch({ execPath: executable, args })
  app.quit()
}
