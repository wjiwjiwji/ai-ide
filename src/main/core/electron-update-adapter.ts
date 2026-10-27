import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type {
  UpdateAdapter,
  UpdateAdapterHandlers
} from './update-service'

export function createElectronUpdateAdapter(): UpdateAdapter {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false

  return {
    setHandlers(handlers: UpdateAdapterHandlers): void {
      autoUpdater.on('checking-for-update', handlers.onChecking)
      autoUpdater.on('update-available', (info) =>
        handlers.onAvailable(info.version)
      )
      autoUpdater.on('update-not-available', handlers.onNotAvailable)
      autoUpdater.on('download-progress', (progress) =>
        handlers.onProgress({
          percent: progress.percent,
          transferred: progress.transferred,
          total: progress.total,
          bytesPerSecond: progress.bytesPerSecond
        })
      )
      autoUpdater.on('update-downloaded', handlers.onDownloaded)
      autoUpdater.on('error', handlers.onError)
    },
    async checkForUpdates(): Promise<unknown> {
      return autoUpdater.checkForUpdates()
    },
    async downloadUpdate(): Promise<unknown> {
      return autoUpdater.downloadUpdate()
    },
    quitAndInstall(): void {
      setImmediate(() => {
        autoUpdater.quitAndInstall(false, true)
      })
    }
  }
}

export function configureUpdateNetwork(): void {
  const proxyRules = process.env.AI_IDE_UPDATER_PROXY?.trim()
  if (proxyRules) {
    app.commandLine.appendSwitch('proxy-server', proxyRules)
    return
  }
  if (process.env.AI_IDE_UPDATER_USE_SYSTEM_PROXY !== '1') {
    // Chromium can keep using a stale system proxy after it has been disabled.
    // Match the default standalone setup while retaining an explicit opt-in.
    app.commandLine.appendSwitch('no-proxy-server')
  }
}
