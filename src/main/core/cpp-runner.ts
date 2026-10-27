import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  access,
  mkdtemp,
  mkdir,
  readdir,
  realpath,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, parse } from 'node:path'
import { promisify } from 'node:util'
import type { CppSyntaxCheckResult } from '../../shared/desktop'

const execFileAsync = promisify(execFile)
const cppExtensions = new Set(['.c', '.cc', '.cpp', '.cxx'])

export interface CppRunPreparation {
  command: string
  compiler: string
  executablePath: string
}

export interface CppDebugBuild {
  executablePath: string
  compiler: string
  output: string
}

interface CppToolchain {
  kind: 'msvc' | 'gcc' | 'clang'
  compilerPath: string
  vcvarsPath?: string
}

function batchPath(value: string): string {
  return `"${value.replaceAll('%', '%%')}"`
}

export function buildCppRunScript(input: {
  toolchain: CppToolchain
  projectRoot: string
  sourcePath: string
  sourcePaths?: string[]
  executablePath: string
  objectDirectory: string
  includeDirectories?: string[]
}): string {
  const sourcePaths =
    input.sourcePaths && input.sourcePaths.length > 0
      ? [...new Set(input.sourcePaths)]
      : [input.sourcePath]
  const lines = [
    '@echo off',
    `cd /d ${batchPath(input.projectRoot)}`,
    'if errorlevel 1 exit /b %errorlevel%'
  ]

  if (input.toolchain.kind === 'msvc') {
    if (!input.toolchain.vcvarsPath) {
      throw new Error('MSVC 环境初始化脚本不存在。')
    }
    const objectPaths = sourcePaths.map((sourcePath, index) =>
      join(
        input.objectDirectory,
        `${parse(input.executablePath).name}${
          sourcePaths.length > 1 ? `-${index + 1}` : ''
        }.obj`
      )
    )
    lines.push(
      `call ${batchPath(input.toolchain.vcvarsPath)} >nul`,
      'if errorlevel 1 (',
      '  echo [AI IDE] Failed to initialize the Visual C++ environment.',
      '  exit /b %errorlevel%',
      ')'
    )
    if (sourcePaths.length === 1) {
      lines.push(
        `${batchPath(input.toolchain.compilerPath)} /nologo /EHsc /std:c++17 /Od /Zi ${cppIncludeFlags('msvc', input.includeDirectories ?? [])} ${batchPath(sourcePaths[0])} /Fe:${batchPath(input.executablePath)} /Fo:${batchPath(objectPaths[0])}`,
        'if errorlevel 1 exit /b %errorlevel%'
      )
    } else {
      sourcePaths.forEach((sourcePath, index) => {
        lines.push(
          `${batchPath(input.toolchain.compilerPath)} /nologo /EHsc /std:c++17 /Od /Zi /c ${cppIncludeFlags('msvc', input.includeDirectories ?? [])} ${batchPath(sourcePath)} /Fo:${batchPath(objectPaths[index])}`,
          'if errorlevel 1 exit /b %errorlevel%'
        )
      })
      lines.push(
        `${batchPath(input.toolchain.compilerPath)} /nologo ${objectPaths
          .map(batchPath)
          .join(' ')} /Fe:${batchPath(input.executablePath)}`,
        'if errorlevel 1 exit /b %errorlevel%'
      )
    }
  } else {
    const compilerDirectory = dirname(input.toolchain.compilerPath)
    lines.push(
      `set "PATH=${compilerDirectory};%PATH%"`,
      `${batchPath(input.toolchain.compilerPath)} -std=c++17 -O0 -g ${cppIncludeFlags(input.toolchain.kind, input.includeDirectories ?? [])} ${sourcePaths.map(batchPath).join(' ')} -o ${batchPath(input.executablePath)}`,
      'if errorlevel 1 exit /b %errorlevel%'
    )
  }

  lines.push(
    'echo.',
    'echo [AI IDE] Build succeeded. Running...',
    batchPath(input.executablePath)
  )
  return `${lines.join('\r\n')}\r\n`
}

function cppIncludeFlags(
  kind: CppToolchain['kind'],
  includeDirectories: string[]
): string {
  const flag = kind === 'msvc' ? '/I' : '-I'
  return [...new Set(includeDirectories)]
    .map((directory) => `${flag}${batchPath(directory)}`)
    .join(' ')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function cppIncludeDirectories(
  projectRoot: string,
  sourcePath: string
): Promise<string[]> {
  const candidates = [
    dirname(sourcePath),
    join(projectRoot, 'src', 'Headers'),
    join(projectRoot, 'include'),
    join(projectRoot, 'Headers')
  ]
  const directories: string[] = []
  for (const candidate of new Set(candidates)) {
    if (await pathExists(candidate)) {
      directories.push(candidate)
    }
  }
  return directories
}

async function collectProjectCppSources(
  projectRoot: string,
  currentSourcePath: string
): Promise<string[]> {
  const sourcePaths = new Set([currentSourcePath])
  const sourceRoot = join(projectRoot, 'src', 'Sources')
  if (!(await pathExists(sourceRoot))) {
    return [...sourcePaths]
  }
  const ignoredDirectories = new Set([
    '.git',
    '.vs',
    '.vscode',
    'build',
    'out',
    'cmake-build-debug',
    'cmake-build-release'
  ])
  const visit = async (directory: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name.toLowerCase())) {
          await visit(path)
        }
      } else if (
        entry.isFile() &&
        cppExtensions.has(extname(entry.name).toLowerCase())
      ) {
        sourcePaths.add(path)
      }
    }
  }
  await visit(sourceRoot)
  return [...sourcePaths].sort((left, right) =>
    left.localeCompare(right, 'en')
  )
}

function toolchainFromCompiler(
  compilerPath: string
): CppToolchain | null {
  const name = basename(compilerPath).toLowerCase()
  if (name === 'cl.exe' || name === 'cl') {
    const marker = '\\vc\\tools\\msvc\\'
    const markerIndex = compilerPath.toLowerCase().indexOf(marker)
    if (markerIndex < 0) {
      return null
    }
    const installRoot = compilerPath.slice(0, markerIndex)
    return {
      kind: 'msvc',
      compilerPath,
      vcvarsPath: join(installRoot, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
    }
  }
  if (name === 'clang++.exe' || name === 'clang++') {
    return { kind: 'clang', compilerPath }
  }
  if (name === 'g++.exe' || name === 'g++') {
    return { kind: 'gcc', compilerPath }
  }
  return null
}

async function findOnPath(names: string[]): Promise<string | null> {
  const directories = (process.env.PATH ?? '').split(';')
  const extensions = process.platform === 'win32' ? ['', '.exe'] : ['']
  for (const directory of directories) {
    for (const name of names) {
      for (const extension of extensions) {
        const candidate = join(directory, `${name}${extension}`)
        if (await pathExists(candidate)) {
          return candidate
        }
      }
    }
  }
  return null
}

async function findMsvcCompiler(): Promise<string | null> {
  const programFilesX86 = process.env['ProgramFiles(x86)']
  const vswhere = programFilesX86
    ? join(
        programFilesX86,
        'Microsoft Visual Studio',
        'Installer',
        'vswhere.exe'
      )
    : null
  if (!vswhere || !(await pathExists(vswhere))) {
    return null
  }
  try {
    const { stdout } = await execFileAsync(vswhere, [
      '-latest',
      '-products',
      '*',
      '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-find',
      'VC\\Tools\\MSVC\\**\\bin\\Hostx64\\x64\\cl.exe'
    ])
    const candidate = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)
    return candidate && (await pathExists(candidate)) ? candidate : null
  } catch {
    return null
  }
}

async function detectToolchain(): Promise<CppToolchain> {
  const localCompiler = process.env.AI_IDE_LOCAL_CPP_COMPILER?.trim()
  if (localCompiler) {
    const compilerPath = await pathExists(localCompiler)
      ? localCompiler
      : await findOnPath([localCompiler])
    const toolchain = compilerPath
      ? toolchainFromCompiler(compilerPath)
      : null
    if (toolchain) {
      return toolchain
    }
  }
  const configured = process.env.AI_IDE_CPP_COMPILER?.trim()
  if (configured) {
    const compilerPath =
      (await pathExists(configured)) ? configured : await findOnPath([configured])
    const toolchain = compilerPath
      ? toolchainFromCompiler(compilerPath)
      : null
    if (!toolchain) {
      throw new Error('AI_IDE_CPP_COMPILER 不是受支持的 C++ 编译器。')
    }
    return toolchain
  }

  const onPath = await findOnPath(['g++', 'clang++'])
  if (onPath) {
    return toolchainFromCompiler(onPath) as CppToolchain
  }

  const msvcCompiler = await findMsvcCompiler()
  if (msvcCompiler) {
    const toolchain = toolchainFromCompiler(msvcCompiler)
    if (toolchain) {
      return toolchain
    }
  }

  throw new Error(
    '未找到 C++ 编译器。请安装 Visual Studio C++ 工作负载，或设置 AI_IDE_CPP_COMPILER。'
  )
}

export async function compileCppForDebug(input: {
  projectRoot: string
  sourcePath: string
  relativeSourcePath: string
  outputRoot: string
  signal?: AbortSignal
}): Promise<CppDebugBuild> {
  const extension = extname(input.sourcePath).toLowerCase()
  if (!cppExtensions.has(extension)) {
    throw new Error('当前文件不是支持的 C/C++ 源文件。')
  }
  const projectRoot = await realpath(input.projectRoot)
  const sourcePath = await realpath(input.sourcePath)
  if (!sourcePath.startsWith(`${projectRoot}\\`) && sourcePath !== projectRoot) {
    throw new Error('源文件不在当前项目中。')
  }

  const toolchain = await detectToolchain()
  if (toolchain.kind === 'msvc') {
    throw new Error(
      '当前调试器需要 GCC 或 Clang 生成的 DWARF 调试信息，请配置 AI_IDE_LOCAL_CPP_COMPILER。'
    )
  }
  const includeDirectories = await cppIncludeDirectories(
    projectRoot,
    sourcePath
  )
  const sourcePaths = await collectProjectCppSources(
    projectRoot,
    sourcePath
  )
  const digest = createHash('sha1')
    .update(input.relativeSourcePath)
    .digest('hex')
    .slice(0, 8)
  const buildDirectory = join(
    input.outputRoot,
    createHash('sha1').update(projectRoot).digest('hex').slice(0, 12),
    digest
  )
  await mkdir(buildDirectory, { recursive: true })
  const executablePath = join(
    buildDirectory,
    `${parse(sourcePath).name}.exe`
  )
  const scriptPath = join(buildDirectory, 'build-cpp-debug.cmd')
  const script = [
    '@echo off',
    `set "PATH=${dirname(toolchain.compilerPath)};%PATH%"`,
    `cd /d ${batchPath(projectRoot)}`,
    'if errorlevel 1 exit /b %errorlevel%',
    `${batchPath(toolchain.compilerPath)} -std=c++17 -O0 -g3 ${cppIncludeFlags(toolchain.kind, includeDirectories)} ${sourcePaths.map(batchPath).join(' ')} -o ${batchPath(executablePath)}`,
    'if errorlevel 1 exit /b %errorlevel%'
  ].join('\r\n')
  await writeFile(scriptPath, `${script}\r\n`, 'utf8')

  try {
    const { stdout, stderr } = await execFileAsync(
      'cmd.exe',
      ['/d', '/s', '/c', scriptPath],
      {
        cwd: projectRoot,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
        signal: input.signal
      }
    )
    if (!(await pathExists(executablePath))) {
      throw new Error('编译器没有生成可执行文件。')
    }
    return {
      executablePath,
      compiler: toolchain.kind === 'clang' ? 'Clang' : 'GCC',
      output: `${stdout}${stderr}`.trim()
    }
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string }
    throw new Error(
      [failure.stdout, failure.stderr, failure.message]
        .filter(Boolean)
        .join('\n')
        .trim() || '调试构建失败。'
    )
  }
}

function runSyntaxCommand(
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 15_000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    const append = (chunk: Buffer): void => {
      output += chunk.toString('utf8')
      if (output.length > 2 * 1024 * 1024) {
        output = output.slice(-2 * 1024 * 1024)
      }
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('语法检查超时。'))
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', () => {
      clearTimeout(timer)
      resolve(output)
    })
  })
}

export async function syntaxCheckCppSource(input: {
  projectRoot: string
  sourcePath: string
  content: string
}): Promise<CppSyntaxCheckResult> {
  if (typeof input.content !== 'string') {
    throw new Error('源文件内容无效。')
  }
  if (Buffer.byteLength(input.content, 'utf8') > 2 * 1024 * 1024) {
    throw new Error('文件超过 2 MB，无法进行实时语法检查。')
  }
  const toolchain = await detectToolchain()
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), 'ai-ide-cpp-lint-')
  )
  const includeDirectories = await cppIncludeDirectories(
    input.projectRoot,
    input.sourcePath
  )
  const temporarySource = join(
    temporaryDirectory,
    basename(input.sourcePath)
  )
  await writeFile(temporarySource, input.content, 'utf8')
  try {
    if (toolchain.kind === 'msvc') {
      if (!toolchain.vcvarsPath) {
        throw new Error('MSVC 环境初始化脚本不存在。')
      }
      const scriptPath = join(temporaryDirectory, 'syntax-check.cmd')
      await writeFile(
        scriptPath,
        [
          '@echo off',
          `call ${batchPath(toolchain.vcvarsPath)} >nul`,
          `"${toolchain.compilerPath}" /nologo /Zs /EHsc /std:c++17 ${cppIncludeFlags('msvc', includeDirectories)} "${temporarySource}"`,
          'exit /b %errorlevel%'
        ].join('\r\n'),
        'utf8'
      )
      const output = await runSyntaxCommand(
        'cmd.exe',
        ['/d', '/s', '/c', scriptPath],
        input.projectRoot,
        process.env
      )
      return {
        output,
        sourcePath: input.sourcePath,
        temporarySource
      }
    }
    const output = await runSyntaxCommand(
      toolchain.compilerPath,
      [
        '-std=c++17',
        '-fsyntax-only',
        '-fdiagnostics-color=never',
        ...includeDirectories.map((directory) => `-I${directory}`),
        temporarySource
      ],
      input.projectRoot,
      {
        ...process.env,
        PATH: `${dirname(toolchain.compilerPath)};${process.env.PATH ?? ''}`
      }
    )
    return {
      output,
      sourcePath: input.sourcePath,
      temporarySource
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

export async function prepareCppRun(input: {
  projectRoot: string
  sourcePath: string
  relativeSourcePath: string
  outputRoot: string
}): Promise<CppRunPreparation> {
  const extension = extname(input.sourcePath).toLowerCase()
  if (!cppExtensions.has(extension)) {
    throw new Error('当前文件不是支持的 C/C++ 源文件。')
  }
  const projectRoot = await realpath(input.projectRoot)
  const sourcePath = await realpath(input.sourcePath)
  if (!sourcePath.startsWith(`${projectRoot}\\`) && sourcePath !== projectRoot) {
    throw new Error('源文件不在当前项目中。')
  }

  const toolchain = await detectToolchain()
  const digest = createHash('sha1')
    .update(input.relativeSourcePath)
    .digest('hex')
    .slice(0, 8)
  const runDirectory = join(
    input.outputRoot,
    createHash('sha1').update(projectRoot).digest('hex').slice(0, 12),
    digest
  )
  await mkdir(runDirectory, { recursive: true })

  const executablePath = join(
    runDirectory,
    `${parse(sourcePath).name}.exe`
  )
  const includeDirectories = await cppIncludeDirectories(
    projectRoot,
    sourcePath
  )
  const sourcePaths = await collectProjectCppSources(
    projectRoot,
    sourcePath
  )
  const scriptPath = join(runDirectory, 'run-cpp.cmd')
  await writeFile(
    scriptPath,
    buildCppRunScript({
      toolchain,
      projectRoot,
      sourcePath,
      sourcePaths,
      executablePath,
      objectDirectory: runDirectory,
      includeDirectories
    }),
    'utf8'
  )

  return {
    command: `& "${scriptPath.replaceAll('"', '""')}"`,
    compiler:
      toolchain.kind === 'msvc'
        ? 'MSVC'
        : toolchain.kind === 'clang'
          ? 'Clang'
          : 'GCC',
    executablePath
  }
}
