import { DEVELOPMENT_RESTART_EXIT_CODE } from '../shared/developmentRestart'
import { restartInstalledApp, type RelaunchApp } from './linuxRelaunch'

type RestartApp = RelaunchApp & { exit: (code: number) => void }

export async function restartAfterDataLocationChange(app: RestartApp, managedDevelopment: boolean, restart = restartInstalledApp) {
  if (managedDevelopment) {
    // Vite owns the development child and launches its replacement. Calling
    // app.relaunch here would leave a child without a live renderer server.
    app.exit(DEVELOPMENT_RESTART_EXIT_CODE)
  } else {
    await restart(app, process.execPath, process.argv.slice(1))
  }
}
