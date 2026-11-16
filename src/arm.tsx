import { useRef, useState } from 'react'

/**
 * Click twice instead of a confirm() alert: the first click arms the button for a moment (it says so, and a bar
 * runs down), the second one does it. Leave it and it disarms on its own.
 */
export function useArm(ms = 3000) {
  const [armed, setArmed] = useState<string>()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const arm = (key: string, run: () => void) => {
    clearTimeout(timer.current)
    if (armed === key) { setArmed(undefined); run(); return }
    setArmed(key)
    timer.current = setTimeout(() => setArmed(undefined), ms)
  }
  return { armed, arm }
}

/**
 * The armed look: the button itself is the timer. A soft wash fills it and drains away while the moment lasts
 * (a white sheen on a coloured button, a tint of its own colour on a light one), and the label slides to "Confirm".
 */
export const armedCls = 'relative isolate overflow-hidden'
export const ArmBar = ({ on = 'color' }: { on?: 'color' | 'plain' }) => (
  <span aria-hidden className={`pointer-events-none absolute inset-0 -z-10 origin-right animate-[arm_3s_linear_forwards] ${on === 'color' ? 'bg-gradient-to-l from-white/35 to-white/10' : 'bg-current opacity-[0.12]'}`} />
)
/** The armed label: slides up into place, so the change reads as a step, not a flicker. */
export const ArmLabel = ({ children }: { children: string }) => <span key={children} className="inline-block animate-[arm-label_220ms_var(--ease-snappy)]">{children}</span>
