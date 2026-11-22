// Where review findings are read and answered: crit (line by line, in its own window) or Concierge itself, with nothing
// else to install. Onboarding asks it; Settings → Workflows changes it.
import { Pick } from '../ui/Pick.tsx'
import { api } from '../lib.ts'
import type { SetupView } from '../../server/index.ts'

export function ReviewIn({ setup, onSaved }: { setup: SetupView; onSaved: (s: SetupView) => void }) {
  const critInstalled = setup.critInstalled
  const save = (reviewIn: 'crit' | 'concierge') => api('/config', { reviewIn }).then(onSaved, () => {})
  return (
    <div className="space-y-2 rounded-2xl px-3.5 py-3 ring-1 ring-line">
      <p className="text-small font-medium text-fg-1">Where you read and answer reviews</p>
      <Pick label="Where you read and answer reviews" value={setup.reviewIn} onChange={save} options={[
        { value: 'concierge', label: 'In Concierge', hint: 'The findings show on the PR page; you keep or drop each, then post. Nothing else to install.' },
        { value: 'crit', label: 'In crit', hint: critInstalled ? 'Line by line in crit’s own window, round by round with the agent.' : 'Line by line in crit’s own window. Install it first: brew install crit', disabled: !critInstalled && setup.reviewIn !== 'crit' },
      ]} />
      <p className="text-meta text-fg-3">{setup.reviewIn === 'crit'
        ? 'The agent opens its findings in crit; you answer there, then post from here.'
        : 'The agent leaves its findings here, on the PR page. crit is optional.'}</p>
    </div>
  )
}
