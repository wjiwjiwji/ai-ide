import { describe, expect, it } from 'vitest'
import {
  appendCppImplementation,
  buildCppImplementation,
  cppFileHasNamespace,
  cppImplementationPath,
  locateCppFunctions,
  parseCppFunctionAt
} from './cpp-functions'

describe('C++ function context', () => {
  it('parses a namespace function declaration from a header', () => {
    const content = `#pragma once
#include <string>

namespace demo {
std::string greeting();
}
`
    expect(parseCppFunctionAt(content, 5, 'greeting')).toMatchObject({
      name: 'greeting',
      returnType: 'std::string',
      parameters: '',
      namespaceName: 'demo',
      hasBody: false
    })
  })

  it('distinguishes declarations from definitions', () => {
    const declaration = `namespace demo {
std::string greeting();
}`
    const definition = `#include "demo.h"
namespace demo {
std::string greeting()
{
}
}`

    expect(parseCppFunctionAt(declaration, 2, 'greeting')?.hasBody).toBe(false)
    expect(parseCppFunctionAt(definition, 3, 'greeting')?.hasBody).toBe(true)
  })

  it('finds a missing implementation and builds a qualified definition', () => {
    const symbol = parseCppFunctionAt(
      'namespace demo {\nstd::string greeting();\n}',
      2,
      'greeting'
    )
    if (!symbol) {
      throw new Error('symbol not parsed')
    }
    const implementation = buildCppImplementation(symbol, {
      qualifyScope: true
    })

    expect(implementation.qualifiedName).toBe('demo::greeting')
    expect(implementation.code).toContain(
      'std::string demo::greeting()'
    )
    expect(implementation.code).toContain('return {};')
  })

  it('maps header and source folders using the project template convention', () => {
    expect(cppImplementationPath('src\\Headers\\Student.h')).toBe(
      'src\\Sources\\Student.cpp'
    )
    expect(cppImplementationPath('include/student.hpp')).toBe(
      'include/student.cpp'
    )
  })

  it('locates both declaration and definition across files', () => {
    const locations = locateCppFunctions(
      [
        {
          path: 'src/Headers/demo.h',
          content: 'namespace demo {\nvoid run(int value);\n}'
        },
        {
          path: 'src/Sources/demo.cpp',
          content: 'namespace demo {\nvoid run(int value)\n{\n}\n}'
        }
      ],
      'run'
    )

    expect(locations).toHaveLength(2)
    expect(locations.map((item) => item.hasBody)).toEqual([false, true])
  })

  it('adds the required header include before the generated definition', () => {
    const result = appendCppImplementation(
      '#include <string>\n',
      'Student.h',
      'void Student::run()\n{\n}'
    )

    expect(result.content).toContain('#include "Student.h"')
    expect(result.content.indexOf('#include "Student.h"')).toBeLessThan(
      result.content.indexOf('void Student::run()')
    )
  })

  it('inserts a namespace function inside the existing namespace block', () => {
    const content = `#include "demo.h"

namespace demo {

}`
    const result = appendCppImplementation(
      content,
      'demo.h',
      'std::string greeting()\n{\n    return {};\n}',
      'demo'
    )

    expect(cppFileHasNamespace(content, 'demo')).toBe(true)
    expect(result.content.indexOf('std::string greeting()')).toBeLessThan(
      result.content.lastIndexOf('}')
    )
    expect(result.insertLine).toBe(6)
  })
})
