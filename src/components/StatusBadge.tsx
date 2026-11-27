import { CircleAlert, CircleCheck, CircleDashed, CircleDot, CircleSlash, LoaderCircle, type LucideIcon } from 'lucide-react'
import type { PrView } from '../lib.ts'

type Kind = 'wait' | 'run' | 'idle' | 'ok' | 'fail'
type Meta = { label: string; icon: LucideIcon; kind: Kind; tone: string; dot: string; spin?: boolean }

// one status grammar everywhere: five kinds, each one colour; only "needs you" and "failed" get a background
const KIND: Record<Kind, { tone: string; dot: string }> = {
  wait: { tone: 'bg-wait/12 text-wait-text', dot: 'bg-wait' },
  fail: { tone: 'bg-fail/12 text-fail-text', dot: 'bg-fail' },
  run: { tone: 'text-run-text', dot: 'bg-run' },
  ok: { tone: 'text-ok-text', dot: 'bg-ok' },
  idle: { tone: 'text-idle', dot: 'bg-idle' },
}
const m = (label: string, icon: LucideIcon, kind: Kind, spin?: boolean): Meta => ({ label, icon, kind, ...KIND[kind], spin })

export const STATUS: Record<PrView['status'], Meta> = {
  'new':         m('New', CircleDashed, 'idle'),
  'queued':      m('Queued', CircleDashed, 'idle'),
  'preparing':   m('Preparing', LoaderCircle, 'run', true),
  'posting':     m('Posting', LoaderCircle, 'run', true),
  'ready':       m('Ready for you', CircleDot, 'wait'),
  'in-review':   m('In review', CircleDot, 'run'),
  'reviewed':    m('Reviewed', CircleCheck, 'ok'),
  'failed':      m('Failed', CircleAlert, 'fail'),
  'interrupted': m('Interrupted', CircleDot, 'wait'),
  'no-checkout': m('No checkout', CircleSlash, 'idle'),
  'clear':       m('All clear', CircleCheck, 'ok'),
  'approved':    m('Approved', CircleCheck, 'ok'),
  'answered':    m('Waiting on reviewers', CircleDashed, 'idle'),
  'closed':      m('Closed', CircleSlash, 'idle'),
}

// on your own PRs a few states read differently
const MINE: Partial<Record<PrView['status'], Meta>> = {
  'new': m('Feedback waiting', CircleDot, 'wait'),
  'ready': m('In crit', CircleDot, 'run'),
  'posting': m('Publishing', LoaderCircle, 'run', true),
}
export const statusMeta = (status: PrView['status'], mine?: boolean): Meta => (mine && MINE[status]) || STATUS[status]

export function StatusBadge({ status, compact, mine, extra }: { status: PrView['status']; compact?: boolean; mine?: boolean; extra?: string }) {
  const m = statusMeta(status, mine)
  return (
    <span title={compact ? m.label : undefined} className={`inline-flex shrink-0 items-center gap-1 h-5 rounded-full px-1.5 text-meta font-medium transition-colors duration-300 ${m.tone}`}>
      <m.icon className={`size-3 ${m.spin ? 'animate-spin' : ''}`} aria-hidden />
      {!compact && m.label}{!compact && extra && <span className="font-semibold"> · {extra}</span>}
    </span>
  )
}
