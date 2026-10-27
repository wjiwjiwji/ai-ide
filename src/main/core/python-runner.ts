import { access } from 'node:fs/promises'
import { delimiter, extname, isAbsolute, join, relative } from 'node:path'
import type { PythonRunPreparation } from '../../shared/desktop'

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function findOnPath(names: string[]): Promise<string | null> {
  const extensions =
    process.platform === 'win32' ? ['', '.exe'] : ['']
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
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

function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function buildCommand(interpreter: string, sourcePath: string): string {
  const executable = quote(interpreter)
  const source = quote(sourcePath)
  return process.platform === 'win32'
    ? `& ${executable} ${source}`
    : `${executable} ${source}`
}

export async function preparePythonRun(input: {
  projectRoot: string
  sourcePath: string
  relativeSourcePath: string
}): Promise<PythonRunPreparation> {
  if (extname(input.sourcePath).toLowerCase() !== '.py') {
    throw new Error('当前文件不是 Python 源文件。')
  }
  const relation = relative(input.projectRoot, input.sourcePath)
  if (
    !relation ||
    relation.startsWith('..') ||
    isAbsolute(relation)
  ) {
    throw new Error('Python 源文件不在当前项目中。')
  }

  const venvCandidates =
    process.platform === 'win32'
      ? [
          process.env.VIRTUAL_ENV
            ? join(process.env.VIRTUAL_ENV, 'Scripts', 'python.exe')
            : null,
          join(input.projectRoot, '.venv', 'Scripts', 'python.exe'),
          join(input.projectRoot, 'venv', 'Scripts', 'python.exe'),
          join(input.projectRoot, 'python.exe')
        ]
      : [
          process.env.VIRTUAL_ENV
            ? join(process.env.VIRTUAL_ENV, 'bin', 'python')
            : null,
          join(input.projectRoot, '.venv', 'bin', 'python'),
          join(input.projectRoot, 'venv', 'bin', 'python')
        ]

  const configured = process.env.AI_IDE_PYTHON?.trim()
  const candidates = [
    configured || null,
    ...venvCandidates
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return {
        command: buildCommand(candidate, input.sourcePath),
        interpreter: candidate,
        sourcePath: input.sourcePath
      }
    }
  }

  const onPath = await findOnPath(['python', 'python3'])
  if (onPath) {
    return {
      command: buildCommand(onPath, input.sourcePath),
      interpreter: onPath,
      sourcePath: input.sourcePath
    }
  }

  if (
    process.platform === 'win32' &&
    (await findOnPath(['py']))
  ) {
    return {
      command: `& "py" -3 "${input.sourcePath}"`,
      interpreter: 'py -3',
      sourcePath: input.sourcePath
    }
  }

  throw new Error(
    '未找到 Python 解释器。请安装 Python，或在项目内创建 .venv。'
  )
}
