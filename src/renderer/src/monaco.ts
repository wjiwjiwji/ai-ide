import '../../../node_modules/monaco-editor/esm/vs/nls/lang/zh-cn.js'
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import cssWorker from 'monaco-editor/language/css/css.worker.js?worker'
import htmlWorker from 'monaco-editor/language/html/html.worker.js?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker.js?worker'
import typescriptWorker from 'monaco-editor/language/typescript/ts.worker.js?worker'
import '../../../node_modules/monaco-editor/esm/vs/basic-languages/monaco.contribution.js'

self.MonacoEnvironment = {
  getWorker(_moduleId: string, label: string): Worker {
    if (label === 'json') {
      return new jsonWorker()
    }

    if (label === 'css' || label === 'scss' || label === 'less') {
      return new cssWorker()
    }

    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new htmlWorker()
    }

    if (label === 'typescript' || label === 'javascript') {
      return new typescriptWorker()
    }

    return new editorWorker()
  }
}

loader.config({ monaco })

const monacoMenuStyleText = `
  .context-view.monaco-menu-container,
  .context-view.monaco-menu-container > .monaco-scrollable-element,
  .context-view.monaco-menu-container .monaco-menu,
  .context-view.monaco-menu-container .monaco-action-bar,
  .context-view.monaco-menu-container .actions-container {
    background-color: #2b2b2d !important;
    color: #ffffff !important;
  }
  .context-view.monaco-menu-container {
    border: 1px solid #55555a !important;
  }
  .context-view.monaco-menu-container .action-menu-item,
  .context-view.monaco-menu-container .action-label,
  .context-view.monaco-menu-container .keybinding,
  .context-view.monaco-menu-container .submenu-indicator {
    color: #ffffff !important;
    opacity: 1 !important;
  }
  .context-view.monaco-menu-container .action-menu-item:hover,
  .context-view.monaco-menu-container .action-item.focused > .action-menu-item {
    background-color: #094771 !important;
    color: #ffffff !important;
  }
  .context-view.monaco-menu-container .action-label.separator {
    border-color: #48484d !important;
  }
  .context-view.monaco-menu-container:focus,
  .context-view.monaco-menu-container :focus {
    outline-color: #007acc !important;
  }
`

function injectMonacoMenuStyle(root: Document | ShadowRoot): void {
  if (root.querySelector('style[data-ai-ide-menu]')) {
    return
  }
  const style = document.createElement('style')
  style.dataset.aiIdeMenu = 'true'
  style.textContent = monacoMenuStyleText
  root.appendChild(style)
}

function applyMonacoMenuThemeToRoot(root: Document | ShadowRoot): void {
  injectMonacoMenuStyle(root)
  root
    .querySelectorAll<HTMLElement>(
      '.context-view.monaco-menu-container > .monaco-scrollable-element'
    )
    .forEach((menu) => {
      menu.style.setProperty('background-color', '#2b2b2d', 'important')
      menu.style.setProperty('color', '#ffffff', 'important')
    })
  root
    .querySelectorAll<HTMLElement>(
      '.context-view.monaco-menu-container .action-menu-item, .context-view.monaco-menu-container .action-label, .context-view.monaco-menu-container .keybinding, .context-view.monaco-menu-container .submenu-indicator'
    )
    .forEach((item) => {
      item.style.setProperty('color', '#ffffff', 'important')
      item.style.setProperty('opacity', '1', 'important')
    })
}

function applyMonacoMenuThemeToDocument(): void {
  const roots = new Set<Document | ShadowRoot>([document])
  const collectShadowRoots = (root: Document | ShadowRoot): void => {
    root.querySelectorAll<HTMLElement>('*').forEach((element) => {
      if (element.shadowRoot && !roots.has(element.shadowRoot)) {
        roots.add(element.shadowRoot)
        collectShadowRoots(element.shadowRoot)
      }
    })
  }
  collectShadowRoots(document)
  for (const root of roots) {
    applyMonacoMenuThemeToRoot(root)
  }
}

function scheduleMonacoMenuTheme(): void {
  for (let delay = 0; delay <= 500; delay += 50) {
    window.setTimeout(applyMonacoMenuThemeToDocument, delay)
  }
}

window.addEventListener(
  'contextmenu',
  scheduleMonacoMenuTheme,
  true
)
window.addEventListener(
  'mousedown',
  (event) => {
    if (event.button === 2) {
      scheduleMonacoMenuTheme()
    }
  },
  true
)

export function refreshMonacoContextMenuTheme(
  editor: monaco.editor.IStandaloneCodeEditor
): void {
  const applyTheme = (): void => {
    const roots = new Set<Document | ShadowRoot>()
    const editorDomNode = editor.getDomNode()
    const startRoot = editorDomNode?.getRootNode()
    if (startRoot && (startRoot instanceof Document || startRoot instanceof ShadowRoot)) {
      roots.add(startRoot)
    }
    roots.add(document)

    for (const root of roots) {
      applyMonacoMenuThemeToRoot(root)
    }
  }

  scheduleMonacoMenuTheme()
}

let completionRequestId = 0

function waitForCompletionDebounce(
  milliseconds: number,
  token: monaco.CancellationToken
): Promise<boolean> {
  return new Promise((resolve) => {
    if (token.isCancellationRequested) {
      resolve(false)
      return
    }
    const timer = setTimeout(() => resolve(!token.isCancellationRequested), milliseconds)
    token.onCancellationRequested(() => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

monaco.languages.registerInlineCompletionsProvider('*', {
  async provideInlineCompletions(model, position, context, token) {
    if (
      !window.desktop?.getAgentCodeCompletion ||
      localStorage.getItem('ai-ide:agent-completion-enabled') === 'off'
    ) {
      return { items: [] }
    }

    const offset = model.getOffsetAt(position)
    const prefix = model.getValueInRange(
      new monaco.Range(
        model.getPositionAt(Math.max(0, offset - 12_000)).lineNumber,
        model.getPositionAt(Math.max(0, offset - 12_000)).column,
        position.lineNumber,
        position.column
      )
    )
    if (!prefix.trim() || prefix.trim().length < 6) {
      return { items: [] }
    }
    const debounce =
      context.triggerKind === monaco.languages.InlineCompletionTriggerKind.Automatic
        ? 320
        : 0
    if (!(await waitForCompletionDebounce(debounce, token)) || token.isCancellationRequested) {
      return { items: [] }
    }

    const requestId = ++completionRequestId
    try {
      const result = await window.desktop.getAgentCodeCompletion({
        path: model.uri.path,
        language: model.getLanguageId(),
        prefix,
        suffix: model.getValueInRange(
          new monaco.Range(
            position.lineNumber,
            position.column,
            model.getPositionAt(Math.min(model.getValueLength(), offset + 6_000))
              .lineNumber,
            model.getPositionAt(Math.min(model.getValueLength(), offset + 6_000))
              .column
          )
        )
      })
      if (
        token.isCancellationRequested ||
        requestId !== completionRequestId ||
        !result.completion
      ) {
        if (
          result.error &&
          context.triggerKind ===
            monaco.languages.InlineCompletionTriggerKind.Explicit
        ) {
          window.dispatchEvent(
            new CustomEvent('ai-ide:completion-error', {
              detail: result.error
            })
          )
        }
        return { items: [] }
      }
      return {
        items: [
          {
            insertText: result.completion,
            range: new monaco.Range(
              position.lineNumber,
              position.column,
              position.lineNumber,
              position.column
            )
          }
        ],
        enableForwardStability: true
      }
    } catch (error) {
      if (
        context.triggerKind ===
        monaco.languages.InlineCompletionTriggerKind.Explicit
      ) {
        window.dispatchEvent(
          new CustomEvent('ai-ide:completion-error', {
            detail:
              error instanceof Error ? error.message : 'Agent 代码补全失败。'
          })
        )
      }
      return { items: [] }
    }
  },
  disposeInlineCompletions() {
    // Monaco owns the returned completion objects.
  }
})

monaco.languages.register({
  id: 'cmake',
  extensions: ['.cmake'],
  filenames: ['CMakeLists.txt']
})

monaco.languages.setMonarchTokensProvider('cmake', {
  tokenizer: {
    root: [
      [/#.*$/, 'comment'],
      [/\b(if|else|elseif|endif|foreach|endforeach|while|endwhile|function|endfunction|macro|endmacro|set|option|project|cmake_minimum_required|add_executable|add_library|target_link_libraries|target_include_directories|find_package|include|message|install|return|break|continue)\b/i, 'keyword'],
      [/\$\{[^}]+\}/, 'variable'],
      [/\$ENV\{[^}]+\}/, 'variable'],
      [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],
      [/[A-Za-z_][\w-]*(?=\s*\()/, 'type.identifier'],
      [/\d+(?:\.\d+)?/, 'number']
    ],
    string: [
      [/[^"]+/, 'string'],
      [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }]
    ]
  }
})
