import { describe, expect, it } from 'vitest'
import {
  debugOutputTarget,
  localizeDebugDiagnostics,
  routeDebugOutput
} from './debug-session'

describe('debug output routing', () => {
  it.each(['stdout', 'stderr'])(
    'routes program %s to the debug console',
    (category) => {
      expect(debugOutputTarget(category)).toBe('program')
    }
  )

  it.each(['console', 'telemetry', undefined, 'unknown'])(
    'routes infrastructure category %s to the output log',
    (category) => {
      expect(debugOutputTarget(category)).toBe('diagnostics')
    }
  )

  it('keeps only program lines from mixed GDB stdout', () => {
    const routed = routeDebugOutput(
      'stdout',
      [
        '=thread-group-added,id="i1"',
        'GNU gdb (GDB) 18.1',
        'Warning: Debuggee TargetArchitecture not detected, assuming x86_64.',
        '[New Thread 36432.0x9148 (id 2)]',
        'Thread 1 hit Breakpoint 1, main () at main.cpp:6',
        'Hello from testcpp!',
        '[Inferior 1 (process 36432) exited normally]',
        ''
      ].join('\n')
    )

    expect(routed.programOutput).toBe('Hello from testcpp!\n')
    expect(routed.diagnosticsOutput).not.toContain('GNU gdb')
    expect(routed.diagnosticsOutput).toContain('[新线程')
    expect(routed.diagnosticsOutput).toContain('已正常退出')
  })

  it('routes cpptools console and telemetry events away from the console', () => {
    expect(
      routeDebugOutput('telemetry', 'VS/Diagnostics/Debugger/Launch')
        .programOutput
    ).toBe('')
    expect(
      routeDebugOutput(
        'console',
        "The program 'C:/temp/main.exe' has exited with code 0 (0x00000000)."
      )
        .diagnosticsOutput
    ).toContain('程序“')
  })

  it('translates debugger infrastructure output while preserving program text', () => {
    const localized = localizeDebugDiagnostics(
      [
        "Loaded 'C:/Windows/System32/msvcrt.dll'. Symbols loaded.",
        '[Thread 47712.0x8c50 (id 3) exited with code 0]',
        '[Inferior 1 (process 47712) exited normally]',
        "The program 'D:/temp/main.exe' has exited with code 0 (0x00000000).",
        'VS/Diagnostics/Debugger/DebugCompleted'
      ].join('\n')
    )

    expect(localized).toContain('已加载“C:/Windows/System32/msvcrt.dll”')
    expect(localized).toContain('已退出，退出代码 0')
    expect(localized).toContain('已正常退出')
    expect(localized).toContain('调试完成。')
    expect(localized).not.toContain('Symbols loaded')
  })

  it('hides noisy GDB banner lines', () => {
    expect(
      localizeDebugDiagnostics(
        [
          'This is free software; you are free to change and redistribute it.',
          '<https://www.gnu.org/software/gdb/bugs/>.',
          'set auto-load safe-path /',
          'Hello from testcpp!'
        ].join('\n')
      )
    ).toBe('Hello from testcpp!')
  })
})
