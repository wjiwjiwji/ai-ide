import { describe, expect, it, vi } from 'vitest'
import {
  UpdateService,
  type UpdateAdapter,
  type UpdateAdapterHandlers
} from './update-service'

function createAdapter(): {
  adapter: UpdateAdapter
  handlers: () => UpdateAdapterHandlers
  checkForUpdates: ReturnType<typeof vi.fn>
  downloadUpdate: ReturnType<typeof vi.fn>
  quitAndInstall: ReturnType<typeof vi.fn>
} {
  let registeredHandlers: UpdateAdapterHandlers | null = null
  const checkForUpdates = vi.fn(async () => undefined)
  const downloadUpdate = vi.fn(async () => [])
  const quitAndInstall = vi.fn()
  return {
    adapter: {
      setHandlers(handlers) {
        registeredHandlers = handlers
      },
      checkForUpdates,
      downloadUpdate,
      quitAndInstall
    },
    handlers: () => {
      if (!registeredHandlers) {
        throw new Error('Handlers not registered')
      }
      return registeredHandlers
    },
    checkForUpdates,
    downloadUpdate,
    quitAndInstall
  }
}

describe('UpdateService', () => {
  it('reports available and downloaded updates', async () => {
    const testAdapter = createAdapter()
    const statuses: string[] = []
    const service = new UpdateService(
      testAdapter.adapter,
      '1.0.0',
      (status) => statuses.push(status.state),
      () => new Date('2026-01-01T00:00:00.000Z')
    )

    const checking = service.checkForUpdates()
    testAdapter.handlers().onAvailable('1.1.0')
    await checking

    expect(service.getStatus()).toMatchObject({
      state: 'available',
      currentVersion: '1.0.0',
      availableVersion: '1.1.0',
      checkedAt: '2026-01-01T00:00:00.000Z'
    })

    const downloading = service.downloadUpdate()
    testAdapter.handlers().onProgress({
      percent: 42,
      transferred: 42,
      total: 100,
      bytesPerSecond: 10
    })
    testAdapter.handlers().onDownloaded()
    await downloading

    expect(service.getStatus().state).toBe('downloaded')
    expect(statuses).toEqual([
      'checking',
      'available',
      'downloading',
      'downloading',
      'downloaded'
    ])
  })

  it('handles no-update and error states', async () => {
    const testAdapter = createAdapter()
    const service = new UpdateService(
      testAdapter.adapter,
      '1.0.0',
      () => undefined
    )

    const checking = service.checkForUpdates()
    testAdapter.handlers().onNotAvailable()
    await checking
    expect(service.getStatus().state).toBe('not-available')

    await service.checkForUpdates()
    testAdapter.handlers().onError(new Error('network unavailable'))
    expect(service.getStatus()).toMatchObject({
      state: 'error',
      message: '更新失败：network unavailable'
    })
  })

  it('installs only after a completed download', async () => {
    const testAdapter = createAdapter()
    const service = new UpdateService(
      testAdapter.adapter,
      '1.0.0',
      () => undefined
    )

    expect(() => service.installUpdate()).toThrow('更新尚未下载完成')

    const checking = service.checkForUpdates()
    testAdapter.handlers().onAvailable('1.1.0')
    await checking
    const downloading = service.downloadUpdate()
    testAdapter.handlers().onDownloaded()
    await downloading
    service.installUpdate()

    expect(testAdapter.quitAndInstall).toHaveBeenCalledOnce()
  })

  it('stays disabled in development mode', async () => {
    const service = new UpdateService(null, '1.0.0', () => undefined)

    expect(service.getStatus().state).toBe('disabled')
    expect(await service.checkForUpdates()).toMatchObject({
      state: 'disabled',
      message: '开发模式不检查更新，请使用安装版测试。'
    })
  })
})
