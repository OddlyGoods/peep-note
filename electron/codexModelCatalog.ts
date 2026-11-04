import { execFile } from 'child_process'
import { findCodexLaunch } from './codexVision'
import { CAPTURE_CODEX_MODELS, parseCodexModelCatalog, type CaptureCodexModel } from '../shared/codexModels'

export async function getCaptureCodexModels(): Promise<CaptureCodexModel[]> {
  try {
    const launch = findCodexLaunch()
    const output = await new Promise<string>((resolve, reject) => {
      execFile(launch.command, [...launch.prefix, 'debug', 'models', '--bundled'], {
        env: launch.env, windowsHide: true, timeout: 8000, maxBuffer: 2 * 1024 * 1024,
      }, (error, stdout) => error ? reject(error) : resolve(stdout))
    })
    const models = parseCodexModelCatalog(JSON.parse(output))
    return models.length ? models : CAPTURE_CODEX_MODELS
  } catch { return CAPTURE_CODEX_MODELS }
}
