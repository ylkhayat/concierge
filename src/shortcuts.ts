// Every key the app answers to, said once: the ? sheet and Settings → About both list these, so neither can name a key
// that is gone or miss one that is there. The handlers live where the keys act (App.tsx, StackNav.tsx, Tour.tsx, the
// composer); a key added there is added here.
import type { View } from './views.ts'

export const shortcuts = (views: View[], codebase: boolean): [string, string][] => {
  const go = views.filter((v) => v.chord)
  return [
    ['⌘K', 'Jump anywhere, run a command'], ['?', 'These shortcuts'],
    ...(go.length ? [[go.map((v) => `g ${v.chord}`).join(' · '), go.map((v) => v.label).join(', ')] as [string, string]] : []),
    ...(codebase ? [['g c', 'Codebase map'] as [string, string]] : []),
    ['g h', 'Open the PR on GitHub'],
    ['j / k', 'Next and previous in the list (Review, Ship)'], ['/', 'Filter the list'], ['Esc', 'Clear the filter, close'],
    ['[ / ]', 'Down and up the stack'], ['← / →', 'Back and next in a tour'],
    ['o', 'Open crit, the line-by-line review'], ['r', 'Resume the agent’s session in your terminal'],
    ['↵', 'Send to the agent (Shift+↵: a new line)'],
    ['Alt ↑ / ↓', 'Move an account in the fallback order (Settings)'],
  ]
}
