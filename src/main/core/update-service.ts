import type {
  AppUpdateProgress,
  AppUpdateStatus
} from '../../shared/desktop'

export interface UpdateAdapterHandlers {
  onChecking: () => void
  onAvailable: (version: string) => void
  onNotAvailable: () => void
  onProgress: (progress: AppUpdateProgress) => void
  onDownloaded: () => void
  onError: (error: unknown) => void
}

export interface UpdateAdapter {
  setHandlers: (handlers: UpdateAdapterHandlers) => void
  checkForUpdates: () => Promise<unknown>
  downloadUpdate: () => Promise<unknown>
  quitAndInstall: () => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class UpdateService {
  private status: AppUpdateStatus

  constructor(
    private readonly adapter: UpdateAdapter | null,
    currentVersion: string,
    private readonly onStatus: (status: AppUpdateStatus) => void,
    private readonly now: () => Date = () => new Date()
  ) {
    this.status = {
      state: adapter ? 'idle' : 'disabled',
      currentVersion,
      availableVersion: null,
      progress: null,
      message: adapter
        ? '尚未检查更新。'
        : '开发模式不检查更新，请使用安装版测试。',
      checkedAt: null
    }

    adapter?.setHandlers({
      onChecking: () => {
        this.setStatus({
          state: 'checking',
          message: '正在检查新版本…'
        })
      },
      onAvailable: (version) => {
        this.setStatus({
          state: 'available',
          availableVersion: version,
          progress: null,
          checkedAt: this.now().toISOString(),
          message: `发现新版本 ${version}。`
        })
      },
      onNotAvailable: () => {
        this.setStatus({
          state: 'not-available',
          availableVersion: null,
          progress: null,
          checkedAt: this.now().toISOString(),
          message: '当前已是最新版本。'
        })
      },
      onProgress: (progress) => {
        this.setStatus({
          state: 'downloading',
          progress,
          message: `正在下载更新：${Math.round(progress.percent)}%`
        })
      },
      onDownloaded: () => {
        this.setStatus({
          state: 'downloaded',
          progress: {
            percent: 100,
            transferred: this.status.progress?.total ?? 0,
            total: this.status.progress?.total ?? 0,
            bytesPerSecond: 0
          },
          message: '更新已下载，重启应用即可安装。'
        })
      },
      onError: (error) => {
        this.setStatus({
          state: 'error',
          checkedAt: this.now().toISOString(),
          message: `更新失败：${errorMessage(error)}`
        })
      }
    })
  }

  getStatus(): AppUpdateStatus {
    return {
      ...this.status,
      progress: this.status.progress ? { ...this.status.progress } : null
    }
  }

  async checkForUpdates(): Promise<AppUpdateStatus> {
    if (!this.adapter || this.status.state === 'checking') {
      return this.getStatus()
    }
    if (
      this.status.state === 'downloading' ||
      this.status.state === 'downloaded'
    ) {
      return this.getStatus()
    }

    this.setStatus({
      state: 'checking',
      progress: null,
      message: '正在检查新版本…'
    })
    try {
      await this.adapter.checkForUpdates()
      if (this.getStatus().state === 'checking') {
        this.setStatus({
          state: 'not-available',
          checkedAt: this.now().toISOString(),
          message: '当前已是最新版本。'
        })
      }
    } catch (error) {
      this.setStatus({
        state: 'error',
        checkedAt: this.now().toISOString(),
        message: `检查更新失败：${errorMessage(error)}`
      })
    }
    return this.getStatus()
  }

  async downloadUpdate(): Promise<AppUpdateStatus> {
    if (!this.adapter) {
      throw new Error('当前环境不支持自动更新。')
    }
    if (this.status.state === 'downloading') {
      return this.getStatus()
    }
    if (this.status.state !== 'available') {
      throw new Error('当前没有可下载的更新。')
    }

    this.setStatus({
      state: 'downloading',
      progress: null,
      message: '正在准备下载更新…'
    })
    try {
      await this.adapter.downloadUpdate()
      if (this.getStatus().state === 'downloading') {
        this.setStatus({
          state: 'downloaded',
          message: '更新已下载，重启应用即可安装。'
        })
      }
    } catch (error) {
      this.setStatus({
        state: 'error',
        message: `下载更新失败：${errorMessage(error)}`
      })
    }
    return this.getStatus()
  }

  installUpdate(): void {
    if (!this.adapter || this.status.state !== 'downloaded') {
      throw new Error('更新尚未下载完成。')
    }
    this.adapter.quitAndInstall()
  }

  private setStatus(patch: Partial<AppUpdateStatus>): void {
    this.status = {
      ...this.status,
      ...patch
    }
    this.onStatus(this.getStatus())
  }
}
