import type {
  GitFileChange,
  GitFileDiff,
  GitStatus,
  ProjectInfo
} from '../../../shared/desktop'

interface SourceControlContentProps {
  project: ProjectInfo | null
  gitStatus: GitStatus
  gitDiff: GitFileDiff | null
  gitBusy: boolean
  gitIgnoreBusy: boolean
  commitMessage: string
  stagedCount: number
  allChangesStaged: boolean
  onRepairGitignore: () => void
  onRefreshGitStatus: () => void
  onOpenGitDiff: (change: GitFileChange) => void
  onSetChangeStaged: (change: GitFileChange, staged: boolean) => void
  onCommitMessageChange: (message: string) => void
  onSetAllChangesStaged: (staged: boolean) => void
  onCreateCommit: () => void
}

function gitKindLabel(change: GitFileChange): string {
  switch (change.kind) {
    case 'added':
    case 'untracked':
      return 'A'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'conflicted':
      return '!'
    default:
      return 'M'
  }
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path
}

function SourceControlContent({
  project,
  gitStatus,
  gitDiff,
  gitBusy,
  gitIgnoreBusy,
  commitMessage,
  stagedCount,
  allChangesStaged,
  onRepairGitignore,
  onRefreshGitStatus,
  onOpenGitDiff,
  onSetChangeStaged,
  onCommitMessageChange,
  onSetAllChangesStaged,
  onCreateCommit
}: SourceControlContentProps): React.JSX.Element {
  return (
    <div className="inspector-content source-control-content">
      <div className="git-summary">
        <div className="git-summary-copy">
          <span className="eyebrow">源代码管理</span>
          <strong>
            {gitStatus.isRepository
              ? gitStatus.branch ?? 'detached HEAD'
              : '本地项目'}
          </strong>
        </div>
        <div className="git-summary-actions">
          <button
            className="git-ignore-button"
            type="button"
            title="一键补充 Visual Studio 和 CMake 推荐忽略规则"
            disabled={
              !project ||
              !gitStatus.isRepository ||
              gitBusy ||
              gitIgnoreBusy
            }
            onClick={onRepairGitignore}
          >
            {gitIgnoreBusy ? '修复中…' : '忽略 VS 文件'}
          </button>
          <button
            className={`git-refresh ${gitBusy ? 'spinning' : ''}`}
            type="button"
            title="刷新 Git 状态"
            disabled={!project || gitBusy}
            onClick={onRefreshGitStatus}
          >
            ↻
          </button>
        </div>
      </div>

      {!project ? (
        <div className="inspector-empty compact">
          <strong>尚未打开项目</strong>
          <p>打开项目后会在这里显示 Git 分支和文件变化。</p>
        </div>
      ) : !gitStatus.isRepository ? (
        <div className="inspector-empty compact">
          <div className="git-empty-icon">GIT</div>
          <strong>当前目录没有 Git 仓库</strong>
          <p>{gitStatus.error ?? '初始化仓库后即可查看文件变化。'}</p>
        </div>
      ) : gitStatus.changes.length === 0 ? (
        <div className="inspector-empty compact">
          <div className="inspector-glyph">
            <span>+0</span>
            <span>−0</span>
          </div>
          <strong>工作区是干净的</strong>
          <p>修改文件并保存后，变化会自动显示在这里。</p>
        </div>
      ) : (
        <div className="git-changes">
          <div className="section-label git-changes-heading">
            <span>未提交的变更</span>
            <span className="count">{gitStatus.changes.length}</span>
          </div>
          {gitStatus.changes.map((change) => (
            <div
              className={`git-change-row ${
                gitDiff?.path === change.path ? 'active' : ''
              }`}
              key={`${change.originalPath ?? ''}-${change.path}`}
              title={change.path}
            >
              <button
                className="git-change-main"
                type="button"
                onClick={() => onOpenGitDiff(change)}
              >
                <span className={`git-kind ${change.kind}`}>
                  {gitKindLabel(change)}
                </span>
                <span className="git-change-copy">
                  <strong>{fileNameFromPath(change.path)}</strong>
                  <small>{change.path}</small>
                </span>
                <span className="git-state">
                  {change.staged ? 'S' : ''}
                  {change.unstaged ? 'W' : ''}
                </span>
              </button>
              <button
                className="git-stage-button"
                type="button"
                title={
                  change.staged && !change.unstaged
                    ? '取消暂存'
                    : '暂存变更'
                }
                disabled={gitBusy}
                onClick={() =>
                  onSetChangeStaged(
                    change,
                    !(change.staged && !change.unstaged)
                  )
                }
              >
                {change.staged && !change.unstaged ? '−' : '+'}
              </button>
            </div>
          ))}
        </div>
      )}

      {gitStatus.isRepository ? (
        <div className="commit-panel">
          <div className="bulk-actions">
            <button
              type="button"
              disabled={
                gitBusy ||
                allChangesStaged ||
                gitStatus.changes.length === 0
              }
              onClick={() => onSetAllChangesStaged(true)}
            >
              全部暂存
            </button>
            <button
              type="button"
              disabled={gitBusy || stagedCount === 0}
              onClick={() => onSetAllChangesStaged(false)}
            >
              取消暂存
            </button>
          </div>
          <textarea
            className="commit-message-input"
            value={commitMessage}
            placeholder="提交信息（必填）"
            rows={3}
            spellCheck={false}
            onChange={(event) =>
              onCommitMessageChange(event.target.value)
            }
          />
          <div className="commit-footer">
            <span>
              {stagedCount
                ? `${stagedCount} 个文件已暂存`
                : '请先暂存要提交的变更'}
            </span>
            <button
              className="commit-button"
              type="button"
              disabled={
                gitBusy || stagedCount === 0 || !commitMessage.trim()
              }
              onClick={onCreateCommit}
            >
              提交
              <kbd>Ctrl ↵</kbd>
            </button>
          </div>
        </div>
      ) : (
        <div className="git-footer-block">
          <div className="block-heading">
            <span>Git 工作区</span>
            <span>—</span>
          </div>
          <p>初始化仓库后，可以在这里暂存并提交文件。</p>
        </div>
      )}
    </div>
  )
}

export default SourceControlContent
