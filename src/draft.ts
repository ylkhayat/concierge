import { useEffect, useState } from 'react'

/**
 * What you are writing to an agent, kept per PR or ticket outside the box: the panel swaps its boxes as runs start
 * and stop (Tell the agent, then Steer), and a box that remounts, or a reload, gets your words back. Cleared when sent.
 */
const kept = new Map<string, string>()
const stored = (k: string) => { try { return sessionStorage.getItem(`draft:${k}`) ?? '' } catch { return '' } }

export function useDraft(key: string) {
  const [state, setState] = useState(() => ({ key, text: kept.get(key) ?? stored(key) }))
  // another PR or ticket in the same box: its own draft
  const text = state.key === key ? state.text : kept.get(key) ?? stored(key)
  const setText = (v: string) => {
    setState({ key, text: v })
    if (v) kept.set(key, v); else kept.delete(key)
    try { if (v) sessionStorage.setItem(`draft:${key}`, v); else sessionStorage.removeItem(`draft:${key}`) } catch { /* private window */ }
  }
  // words added from elsewhere (a passage quoted from the panel beside the chat) show in the open box at once
  useEffect(() => {
    const on = () => setState({ key, text: kept.get(key) ?? stored(key) })
    addEventListener(`draft:${key}`, on)
    return () => removeEventListener(`draft:${key}`, on)
  }, [key])
  return [text, setText] as const
}

/** Add to a PR's or ticket's draft from outside its box: a quoted passage, then a blank line to write under it. */
export function appendDraft(key: string, add: string) {
  const now = kept.get(key) ?? stored(key)
  const v = `${now.trim() ? `${now.trimEnd()}\n\n` : ''}${add}`
  kept.set(key, v)
  try { sessionStorage.setItem(`draft:${key}`, v) } catch { /* private window */ }
  dispatchEvent(new CustomEvent(`draft:${key}`))
}
