import { describe, expect, it } from 'vitest'
import { buildCppRunScript } from './cpp-runner'

describe('C++ run script', () => {
  it('builds an MSVC compile-and-run script', () => {
    const script = buildCppRunScript({
      toolchain: {
        kind: 'msvc',
        compilerPath: 'D:\\Visual Studio\\VC\\Tools\\MSVC\\cl.exe',
        vcvarsPath:
          'D:\\Visual Studio\\VC\\Auxiliary\\Build\\vcvars64.bat'
      },
      projectRoot: 'E:\\Projects\\hello',
      sourcePath: 'E:\\Projects\\hello\\main.cpp',
      executablePath: 'C:\\Temp\\run\\main.exe',
      objectDirectory: 'C:\\Temp\\run',
      includeDirectories: ['E:\\Projects\\hello\\src\\Headers']
    })

    expect(script).toContain('vcvars64.bat')
    expect(script).toContain('/EHsc /std:c++17 /Od')
    expect(script).toContain('"E:\\Projects\\hello\\main.cpp"')
    expect(script).toContain('"C:\\Temp\\run\\main.exe"')
    expect(script).toContain('"C:\\Temp\\run\\main.obj"')
    expect(script).toContain('/I"E:\\Projects\\hello\\src\\Headers"')
    expect(script).not.toContain('/O0')
  })

  it('builds a GCC compile-and-run script', () => {
    const script = buildCppRunScript({
      toolchain: {
        kind: 'gcc',
        compilerPath: 'C:\\mingw64\\bin\\g++.exe'
      },
      projectRoot: 'E:\\Projects\\hello',
      sourcePath: 'E:\\Projects\\hello\\main.cpp',
      executablePath: 'C:\\Temp\\run\\main.exe',
      objectDirectory: 'C:\\Temp\\run',
      includeDirectories: ['E:\\Projects\\hello\\src\\Headers']
    })

    expect(script).toContain('-std=c++17 -O0 -g')
    expect(script).toContain('-I"E:\\Projects\\hello\\src\\Headers"')
    expect(script).not.toContain('vcvars64.bat')
  })

  it('links every C++ source file in a GCC project', () => {
    const script = buildCppRunScript({
      toolchain: {
        kind: 'gcc',
        compilerPath: 'C:\\mingw64\\bin\\g++.exe'
      },
      projectRoot: 'E:\\Projects\\hello',
      sourcePath: 'E:\\Projects\\hello\\src\\Sources\\main.cpp',
      sourcePaths: [
        'E:\\Projects\\hello\\src\\Sources\\main.cpp',
        'E:\\Projects\\hello\\src\\Sources\\greeting.cpp'
      ],
      executablePath: 'C:\\Temp\\run\\main.exe',
      objectDirectory: 'C:\\Temp\\run',
      includeDirectories: ['E:\\Projects\\hello\\src\\Headers']
    })

    expect(script).toContain('"E:\\Projects\\hello\\src\\Sources\\main.cpp"')
    expect(script).toContain(
      '"E:\\Projects\\hello\\src\\Sources\\greeting.cpp"'
    )
  })

  it('escapes percent signs in batch paths', () => {
    const script = buildCppRunScript({
      toolchain: {
        kind: 'gcc',
        compilerPath: 'C:\\tools\\g++.exe'
      },
      projectRoot: 'E:\\100% Code',
      sourcePath: 'E:\\100% Code\\main.cpp',
      executablePath: 'C:\\Temp\\main.exe',
      objectDirectory: 'C:\\Temp'
    })

    expect(script).toContain('E:\\100%% Code')
  })
})
