import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { DEVELOPMENT_RESTART_EXIT_CODE } from '../shared/developmentRestart'

type DevelopmentHost = {
  env: NodeJS.ProcessEnv
  electronApp?: ChildProcess
  exit: (code?: number) => void
}
type Startup = (argv?: string[], options?: SpawnOptions) => Promise<void>

export async function startDevelopmentElectron(startup: Startup, host: DevelopmentHost = process) {
  await startup(undefined, { env: { ...host.env, PEEPNOTE_MANAGED_DEV_RESTART: '1' } })
  const child = host.electronApp
  if (!child) throw new Error('Electron development process was not started')

  // vite-plugin-electron normally exits Vite whenever Electron exits. Replace
  // that listener so a requested restart keeps the renderer server available.
  child.removeListener('exit', host.exit)
  child.once('exit', (code, signal) => {
    host.electronApp = undefined
    if (code === DEVELOPMENT_RESTART_EXIT_CODE && !signal) {
      void startDevelopmentElectron(startup, host).catch(error => {
        console.error('Could not restart the development app:', error)
        host.exit(1)
      })
    } else host.exit(code ?? 1)
  })
}
