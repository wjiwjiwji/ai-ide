import { useEffect, useState, type PointerEvent } from 'react'

interface FloatingDetailWindowProps {
  title: string
  subtitle?: string
  children: React.ReactNode
  onClose: () => void
}

interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

function FloatingDetailWindow({
  title,
  subtitle,
  children,
  onClose
}: FloatingDetailWindowProps): React.JSX.Element {
  const [bounds, setBounds] = useState<WindowBounds>(() => {
    const width = Math.min(520, window.innerWidth - 32)
    const height = Math.min(340, window.innerHeight - 80)
    return {
      x: Math.max(16, window.innerWidth - width - 28),
      y: Math.max(46, Math.round((window.innerHeight - height) / 2)),
      width,
      height
    }
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const beginDrag = (
    event: PointerEvent<HTMLButtonElement>
  ): void => {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    const startX = event.clientX
    const startY = event.clientY
    const initial = bounds
    const handlePointerMove = (moveEvent: globalThis.PointerEvent): void => {
      setBounds({
        ...initial,
        x: Math.min(
          Math.max(8, window.innerWidth - initial.width - 8),
          Math.max(8, initial.x + moveEvent.clientX - startX)
        ),
        y: Math.min(
          Math.max(34, window.innerHeight - initial.height - 8),
          Math.max(34, initial.y + moveEvent.clientY - startY)
        )
      })
    }
    const handlePointerUp = (): void => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
  }

  return (
    <section
      className="floating-detail-window"
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height
      }}
      aria-label={title}
    >
      <header>
        <button
          type="button"
          className="floating-detail-drag"
          aria-label={`拖动${title}窗口`}
          title="拖动窗口"
          onPointerDown={beginDrag}
        >
          ⠿
        </button>
        <div>
          <strong>{title}</strong>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
        <button
          type="button"
          className="floating-detail-close"
          aria-label={`关闭${title}`}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="floating-detail-content">{children}</div>
    </section>
  )
}

export default FloatingDetailWindow
