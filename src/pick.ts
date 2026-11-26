import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from 'react'

/**
 * Pick by dragging: press on a row and move over others, and each one you pass takes the state the first one is
 * turning to (picked, or unpicked). A press that never leaves its row is an ordinary click. Rows spread `bind(id)`.
 */
export function useDragPick(picked: string[], onPick: (ids: string[]) => void) {
  const now = useRef(picked)
  now.current = picked
  const pickNow = useRef(onPick)
  pickNow.current = onPick
  const drag = useRef<{ start: string; on: boolean; moved: boolean }>(undefined)
  const dragged = useRef(false) // the click that ends a drag opens nothing
  useEffect(() => {
    const up = () => {
      if (drag.current?.moved) { dragged.current = true; setTimeout(() => { dragged.current = false }) }
      drag.current = undefined
      document.documentElement.classList.remove('select-none')
    }
    addEventListener('pointerup', up)
    return () => removeEventListener('pointerup', up)
  }, [])
  // one function for good (it reads everything through refs), so rows memoized on it keep still
  return useCallback((id: string, pickable = true) => {
    const set = (id: string) => {
      const on = drag.current!.on, has = now.current.includes(id)
      if (on === has) return
      now.current = on ? [...now.current, id] : now.current.filter((x) => x !== id)
      pickNow.current(now.current)
    }
    return pickable ? {
      onPointerDown: (e: PointerEvent) => { if (e.button === 0 && e.pointerType === 'mouse') drag.current = { start: id, on: !now.current.includes(id), moved: false } },
      onPointerEnter: () => {
        const d = drag.current
        if (!d || d.start === id && !d.moved) return
        if (!d.moved) { d.moved = true; document.documentElement.classList.add('select-none'); getSelection()?.removeAllRanges(); set(d.start) }
        set(id)
      },
      onClickCapture: (e: MouseEvent) => { if (dragged.current) { e.preventDefault(); e.stopPropagation() } },
    } : {}
  }, [])
}
