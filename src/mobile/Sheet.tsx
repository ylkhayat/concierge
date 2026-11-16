import { X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// open sheets, innermost last: the page scrolls only when none is open, and Back closes the innermost
const stack: { close: () => void }[] = []
const lock = () => { document.documentElement.style.overflow = stack.length ? 'hidden' : '' }
addEventListener('popstate', () => { stack.at(-1)?.close() })

/**
 * A bottom sheet, the way a phone does them: it slides up over the page (dimmed behind it), its content scrolls
 * inside it, and it goes away by dragging it down (from its handle, or from the content once that is scrolled to
 * the top), by tapping outside, or with the phone's Back. `tall`: always nearly the full height (a reader), else as
 * tall as its content.
 */
export function Sheet({ onClose, title, children, tall, footer }: {
  onClose: () => void; title?: ReactNode; children: ReactNode; tall?: boolean; footer?: ReactNode
}) {
  const box = useRef<HTMLDivElement>(null), body = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false) // false while it slides in and out
  const [drag, setDrag] = useState(0)
  const closing = useRef(false)
  const close = useRef(() => {})
  close.current = () => {
    if (closing.current) return
    closing.current = true
    setShown(false)
    setTimeout(onClose, 220)
  }

  // Back closes it: one history entry per open sheet
  useEffect(() => {
    const me = { close: () => close.current() }
    stack.push(me); lock()
    history.pushState({ sheet: stack.length }, '')
    requestAnimationFrame(() => setShown(true))
    return () => {
      const i = stack.indexOf(me)
      if (i >= 0) stack.splice(i, 1)
      lock()
    }
  }, [])
  // closed by a tap or a drag (not Back): take its history entry back off
  const dismiss = () => history.back() // its own entry: popstate closes the innermost, this one

  // dragging down: from anywhere on the sheet while its content is at the top, a downward pull moves it
  useEffect(() => {
    const el = box.current!
    let y0: number | undefined, last = 0, t0 = 0
    const start = (e: TouchEvent) => {
      const inBody = body.current?.contains(e.target as Node)
      if (inBody && (body.current!.scrollTop > 0 || (e.target as HTMLElement).closest('[data-noswipe], textarea, input, pre'))) { y0 = undefined; return }
      y0 = e.touches[0].clientY; last = 0; t0 = Date.now()
    }
    const move = (e: TouchEvent) => {
      if (y0 === undefined) return
      const dy = e.touches[0].clientY - y0
      if (dy <= 0) { if (last) { last = 0; setDrag(0) } return }
      e.preventDefault() // the sheet moves, not the page behind it
      last = dy; setDrag(dy)
    }
    const end = () => {
      if (y0 === undefined) return
      const fast = last > 40 && Date.now() - t0 < 250
      y0 = undefined
      if (last > 110 || fast) dismiss()
      else setDrag(0)
      last = 0
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => { el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move); el.removeEventListener('touchend', end); el.removeEventListener('touchcancel', end) }
  }, [])

  return createPortal(
    <div className="fixed inset-0 z-50">
      <button aria-label="Close" onClick={dismiss}
              className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`} />
      <div ref={box} role="dialog" aria-modal
           style={{ transform: shown ? `translateY(${drag}px)` : 'translateY(100%)', transition: drag ? 'none' : 'transform 260ms cubic-bezier(0.32, 0.72, 0, 1)' }}
           className={`absolute inset-x-0 bottom-0 flex flex-col rounded-t-[28px] bg-surface-1 shadow-[0_-20px_60px_-20px_rgb(0_0_0/0.5)] ${tall ? 'h-[94dvh]' : 'max-h-[90dvh]'}`}>
        <div className="flex shrink-0 cursor-grab flex-col px-5 pb-2 pt-2.5">
          <span aria-hidden className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-fill-strong" />
          {title !== undefined && (
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">{title}</div>
              <button onClick={dismiss} aria-label="Close" className="-mr-1.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-fill text-fg-3 active:scale-95"><X className="size-4.5" /></button>
            </div>
          )}
        </div>
        <div ref={body} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-px">{children}</div>
        {footer && <div className="shrink-0 border-t border-line px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 ">{footer}</div>}
        {!footer && <div className="h-[env(safe-area-inset-bottom)] shrink-0" />}
      </div>
    </div>,
    document.body,
  )
}
