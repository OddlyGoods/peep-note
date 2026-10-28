import { DEVELOPMENT_RESTART_EXIT_CODE } from '../shared/developmentRestart'

type RestartApp = { exit: (code: number) => void; relaunch: () => void; quit: () => void }

export function restartAfterDataLocationChange(app: RestartApp, managedDevelopment: boolean) {
  if (managedDevelopment) {
    // Vite owns the development child and launches its replacement. Calling
    // app.relaunch here would leave a child without a live renderer server.
    app.exit(DEVELOPMENT_RESTART_EXIT_CODE)
  } else {
    app.relaunch()
    app.quit()
  }
}
