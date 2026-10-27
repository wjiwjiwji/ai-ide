import { describe, expect, it } from 'vitest'
import { isCheckpointIgnoredDirectory } from './checkpoint-policy'

describe('checkpoint directory policy', () => {
  it('ignores Visual Studio and CMake generated directories', () => {
    expect(isCheckpointIgnoredDirectory('.vs')).toBe(true)
    expect(isCheckpointIgnoredDirectory('.VS')).toBe(true)
    expect(isCheckpointIgnoredDirectory('CMakeFiles')).toBe(true)
    expect(isCheckpointIgnoredDirectory('cmake-build-debug')).toBe(true)
    expect(isCheckpointIgnoredDirectory('cmake-build-release')).toBe(true)
    expect(isCheckpointIgnoredDirectory('.cache')).toBe(true)
  })

  it('keeps normal project directories', () => {
    expect(isCheckpointIgnoredDirectory('src')).toBe(false)
    expect(isCheckpointIgnoredDirectory('Headers')).toBe(false)
    expect(isCheckpointIgnoredDirectory('Sources')).toBe(false)
  })

  it('keeps existing ignore behavior', () => {
    expect(isCheckpointIgnoredDirectory('.git')).toBe(true)
    expect(isCheckpointIgnoredDirectory('node_modules')).toBe(true)
    expect(isCheckpointIgnoredDirectory('build')).toBe(true)
  })
})
