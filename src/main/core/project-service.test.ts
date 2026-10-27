import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createProjectDirectory,
  normalizeProjectName,
  projectTemplateCommands,
  scaffoldProject
} from './project-service'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ai-ide-project-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('project creation', () => {
  it('normalizes valid project names', () => {
    expect(normalizeProjectName('  my-project  ')).toBe('my-project')
  })

  it.each([
    '',
    '.',
    '..',
    'bad/name',
    'bad\\name',
    'bad:name',
    'name.',
    'name*',
    'CON',
    'com1'
  ])('rejects invalid project name %s', (name) => {
    expect(() => normalizeProjectName(name)).toThrow()
  })

  it('creates a new project directory inside the selected parent', async () => {
    const parent = await createTemporaryDirectory()
    const project = await createProjectDirectory(parent, 'new-app')

    expect(project.name).toBe('new-app')
    expect(await readdir(parent)).toEqual(['new-app'])
  })

  it('does not overwrite an existing project directory', async () => {
    const parent = await createTemporaryDirectory()
    await mkdir(join(parent, 'existing'))

    await expect(
      createProjectDirectory(parent, 'existing')
    ).rejects.toThrow('同名文件夹已经存在')
  })

  it('creates a C++ CMake project template', async () => {
    const parent = await createTemporaryDirectory()
    const project = await createProjectDirectory(parent, 'native-app')
    await scaffoldProject(project.path, project.name, 'cpp-console')

    expect(await readdir(project.path)).toEqual(
      expect.arrayContaining([
        '.gitignore',
        'CMakeLists.txt',
        'README.md',
        'src'
      ])
    )
    expect(await readdir(join(project.path, 'src'))).toEqual(
      expect.arrayContaining(['Headers', 'Sources'])
    )
    expect(
      await readdir(join(project.path, 'src', 'Headers'))
    ).toContain('native_app.h')
    expect(await readdir(join(project.path, 'src', 'Sources'))).toEqual(
      expect.arrayContaining(['main.cpp', 'native_app.cpp'])
    )

    const cmakeLists = await readFile(
      join(project.path, 'CMakeLists.txt'),
      'utf8'
    )
    expect(cmakeLists).toContain('source_group("Header Files"')
    expect(cmakeLists).toContain('target_include_directories')
    expect(cmakeLists).toContain('src/Headers/*.h')
    expect(cmakeLists).toContain('src/Sources/*.cpp')
    const gitignore = await readFile(
      join(project.path, '.gitignore'),
      'utf8'
    )
    expect(gitignore).toContain('.vs/')
    expect(gitignore).toContain('*.VC.db')
    expect(gitignore).toContain('*.user')

    const mainSource = await readFile(
      join(project.path, 'src', 'Sources', 'main.cpp'),
      'utf8'
    )
    expect(mainSource).toContain('#include "native_app.h"')
    expect(mainSource).toContain('native_app::greeting()')
  })

  it('creates Python, Java and TypeScript project files', async () => {
    const parent = await createTemporaryDirectory()
    const pythonProject = await createProjectDirectory(parent, 'python-app')
    const javaProject = await createProjectDirectory(parent, 'java-app')
    const tsProject = await createProjectDirectory(parent, 'web-app')

    await scaffoldProject(
      pythonProject.path,
      pythonProject.name,
      'python-app'
    )
    await scaffoldProject(javaProject.path, javaProject.name, 'java-maven')
    await scaffoldProject(
      tsProject.path,
      tsProject.name,
      'typescript-node'
    )

    expect(await readdir(pythonProject.path)).toEqual(
      expect.arrayContaining(['main.py', 'pyproject.toml'])
    )
    expect(await readdir(javaProject.path)).toContain('pom.xml')
    expect(await readdir(tsProject.path)).toEqual(
      expect.arrayContaining(['package.json', 'tsconfig.json', 'src'])
    )
    expect(
      projectTemplateCommands('java-app', 'java-maven').runCommand
    ).toContain('com.example.java_app.App')
  })
})
