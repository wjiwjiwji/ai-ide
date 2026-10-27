import { lstat, mkdir, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ProjectTemplateId } from '../../shared/desktop'

const windowsReservedName =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

export function normalizeProjectName(name: string): string {
  if (typeof name !== 'string') {
    throw new Error('项目名称无效。')
  }
  const normalized = name.trim()
  if (!normalized) {
    throw new Error('请输入项目名称。')
  }
  if (normalized.length > 80) {
    throw new Error('项目名称不能超过 80 个字符。')
  }
  if (normalized === '.' || normalized === '..') {
    throw new Error('项目名称无效。')
  }
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(normalized)) {
    throw new Error('项目名称不能包含 < > : " / \\ | ? * 等字符。')
  }
  if (/[. ]$/.test(normalized)) {
    throw new Error('项目名称不能以句点或空格结尾。')
  }
  if (windowsReservedName.test(normalized)) {
    throw new Error('该项目名称是 Windows 保留名称。')
  }
  return normalized
}

export async function createProjectDirectory(
  parentPath: string,
  name: string
): Promise<{ name: string; path: string }> {
  if (typeof parentPath !== 'string' || !parentPath.trim()) {
    throw new Error('请选择项目保存位置。')
  }
  const parentStats = await stat(parentPath)
  if (!parentStats.isDirectory()) {
    throw new Error('项目保存位置不是文件夹。')
  }

  const parentRoot = await realpath(parentPath)
  const normalizedName = normalizeProjectName(name)
  const targetPath = join(parentRoot, normalizedName)
  try {
    await lstat(targetPath)
    throw new Error('同名文件夹已经存在，请换一个项目名称。')
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === '同名文件夹已经存在，请换一个项目名称。'
    ) {
      throw error
    }
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  await mkdir(targetPath)
  return {
    name: normalizedName,
    path: await realpath(targetPath)
  }
}

function projectIdentifier(name: string): string {
  const identifier = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return identifier && /^[a-z_]/.test(identifier)
    ? identifier
    : `app_${identifier || 'project'}`
}

function artifactIdentifier(name: string): string {
  const identifier = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return identifier || 'app'
}

function javaPackage(name: string): string {
  return `com.example.${projectIdentifier(name)}`
}

function templateFiles(
  projectName: string,
  template: ProjectTemplateId
): Record<string, string> {
  const identifier = projectIdentifier(projectName)
  const artifact = artifactIdentifier(projectName)
  const commonEditorConfig = `root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2

[*.{py,java}]
indent_size = 4
`
  const commonReadme = `# ${projectName}

使用 AI IDE 创建的项目。
`
  const files: Record<string, string> = {
    '.editorconfig': commonEditorConfig,
    'README.md': commonReadme
  }

  if (template === 'cpp-console') {
    files['.gitignore'] = `# CMake build output
build/
out/
cmake-build-*/
CMakeFiles/
CMakeCache.txt
cmake_install.cmake
CTestTestfile.cmake
Testing/
compile_commands.json
CMakeUserPresets.json

# Visual Studio local state
.vs/
*.VC.db
*.VC.db-shm
*.VC.db-wal
*.VC.opendb
*.suo
*.user
*.userosscache
*.sln.docstates
*.ipch
*.aps
*.ncb
.cache/

# Compiler output
*.obj
*.o
*.exe
*.pdb
*.ilk
*.exp
`
    files['CMakeLists.txt'] = `cmake_minimum_required(VERSION 3.20)
project(${identifier} LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY \${CMAKE_BINARY_DIR}/bin)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY_DEBUG \${CMAKE_BINARY_DIR}/bin)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY_RELEASE \${CMAKE_BINARY_DIR}/bin)

file(GLOB_RECURSE PROJECT_HEADERS CONFIGURE_DEPENDS
  "src/Headers/*.h"
  "src/Headers/*.hpp"
)
file(GLOB_RECURSE PROJECT_SOURCES CONFIGURE_DEPENDS
  "src/Sources/*.cpp"
)

source_group("Header Files" FILES \${PROJECT_HEADERS})
source_group("Source Files" FILES \${PROJECT_SOURCES})

add_executable(${identifier} \${PROJECT_HEADERS} \${PROJECT_SOURCES})
target_include_directories(${identifier} PRIVATE "\${CMAKE_CURRENT_SOURCE_DIR}/src/Headers")
target_compile_features(${identifier} PRIVATE cxx_std_20)
target_compile_options(${identifier} PRIVATE $<$<CXX_COMPILER_ID:MSVC>:/utf-8>)
`
    files[`src/Headers/${identifier}.h`] = `#pragma once

#include <string>

namespace ${identifier} {

std::string greeting();

}
`
    files[`src/Sources/${identifier}.cpp`] = `#include "${identifier}.h"

namespace ${identifier} {

std::string greeting() {
  return "Hello from ${projectName}!";
}

}
`
    files['src/Sources/main.cpp'] = `#include "${identifier}.h"

#include <iostream>

int main() {
  std::cout << ${identifier}::greeting() << std::endl;
  return 0;
}
`
    files['README.md'] = `${commonReadme}

## 目录结构

\`\`\`text
src/Headers/${identifier}.h             # 头文件
src/Sources/${identifier}.cpp           # 实现文件
src/Sources/main.cpp                    # 程序入口
CMakeLists.txt                          # 构建配置
\`\`\`

## 构建

\`\`\`powershell
cmake -S . -B build
cmake --build build
\`\`\`
`
  } else if (template === 'python-app') {
    files['.gitignore'] = `__pycache__/
*.py[cod]
.venv/
.pytest_cache/
dist/
build/
`
    files['pyproject.toml'] = `[build-system]
requires = ["setuptools>=70"]
build-backend = "setuptools.build_meta"

[project]
name = "${artifact}"
version = "0.1.0"
description = "${projectName}"
requires-python = ">=3.10"

[project.scripts]
${artifact} = "main:main"
`
    files['main.py'] = `def main() -> None:
    print("Hello from ${projectName}!")


if __name__ == "__main__":
    main()
`
    files['README.md'] = `${commonReadme}
## 运行

\`\`\`powershell
python main.py
\`\`\`
`
  } else if (template === 'java-maven') {
    const packageName = javaPackage(projectName)
    const packagePath = packageName.split('.').join('/')
    files['.gitignore'] = `target/
.idea/
*.iml
*.class
`
    files['pom.xml'] = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>${artifact}</artifactId>
  <version>0.1.0-SNAPSHOT</version>
  <properties>
    <maven.compiler.release>21</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.11.4</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.codehaus.mojo</groupId>
        <artifactId>exec-maven-plugin</artifactId>
        <version>3.5.0</version>
      </plugin>
    </plugins>
  </build>
</project>
`
    files[`src/main/java/${packagePath}/App.java`] =
      `package ${packageName};

public final class App {
  public static void main(String[] args) {
    System.out.println("Hello from ${projectName}!");
  }
}
`
    files[`src/test/java/${packagePath}/AppTest.java`] =
      `package ${packageName};

import static org.junit.jupiter.api.Assertions.assertTrue;
import org.junit.jupiter.api.Test;

class AppTest {
  @Test
  void projectBoots() {
    assertTrue(true);
  }
}
`
    files['README.md'] = `${commonReadme}
## 运行

\`\`\`powershell
mvn test
mvn exec:java -Dexec.mainClass=${packageName}.App
\`\`\`
`
  } else if (template === 'typescript-node') {
    files['.gitignore'] = `node_modules/
dist/
coverage/
*.log
`
    files['package.json'] = `${JSON.stringify(
      {
        name: artifact,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: {
          dev: 'tsx src/index.ts',
          build: 'tsc',
          typecheck: 'tsc --noEmit'
        },
        devDependencies: {
          tsx: '^4.20.6',
          typescript: '^7.0.2',
          '@types/node': '^24.0.0'
        }
      },
      null,
      2
    )}\n`
    files['tsconfig.json'] = `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          outDir: 'dist',
          rootDir: 'src',
          skipLibCheck: true
        },
        include: ['src/**/*.ts']
      },
      null,
      2
    )}\n`
    files['src/index.ts'] = `const message: string = "Hello from ${projectName}!"
console.log(message)
`
    files['README.md'] = `${commonReadme}
## 运行

\`\`\`powershell
npm install
npm run dev
\`\`\`
`
  }

  return files
}

export async function scaffoldProject(
  projectPath: string,
  projectName: string,
  template: ProjectTemplateId
): Promise<void> {
  const files = templateFiles(projectName, template)
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = join(projectPath, relativePath)
    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, content, 'utf8')
  }
}

export function projectTemplateCommands(
  projectName: string,
  template: ProjectTemplateId
): { runCommand: string; diagnosticsCommand: string } {
  const identifier = projectIdentifier(projectName)
  if (template === 'cpp-console') {
    return {
      runCommand:
        `cmake -S . -B build && cmake --build build && & ".\\build\\bin\\${identifier}.exe"`,
      diagnosticsCommand: 'cmake --build build'
    }
  }
  if (template === 'python-app') {
    return {
      runCommand: 'python main.py',
      diagnosticsCommand: 'python -m compileall -q .'
    }
  }
  if (template === 'java-maven') {
    return {
      runCommand: `mvn exec:java -Dexec.mainClass=${javaPackage(projectName)}.App`,
      diagnosticsCommand: 'mvn -q -DskipTests compile'
    }
  }
  if (template === 'typescript-node') {
    return {
      runCommand: 'npm run dev',
      diagnosticsCommand: 'npm run typecheck'
    }
  }
  return {
    runCommand: '',
    diagnosticsCommand: ''
  }
}
