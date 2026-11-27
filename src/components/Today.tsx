import { ArrowRight, CircleCheck, Coins, GitPullRequest, ListTodo, LoaderCircle, Sparkles, TriangleAlert } from 'lucide-react'
import { ago, type Health, type PrView, type TicketView } from '../lib.ts'
import { groupOf } from './ExecList.tsx'
import { waiting } from './PrList.tsx'
import { useHeld } from '../held.ts'

type Item = { key: string; kind: 'pr' | 'ticket'; id: string; ref: string; title: string; what: string; at: string; repo?: string }

const prWhat = (p: PrView) => p.mine
  ? p.status === 'approved' ? 'Approved, a few comments to answer' : 'New feedback on your PR'
  : p.status === 'in-review' ? 'You are partway through this review' : 'The AI review is ready for you'
const ticketWhat = (t: TicketView) => groupOf(t).id === 'needs-you' ? 'The agent asked you something' : t.pr?.ci === 'failure' ? 'CI is red on its PR' : 'Review threads to answer'
const avg = (xs: (number | undefined)[]) => { const v = xs.filter((x): x is number => !!x); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined }
const usd = (n?: number) => n == null ? '–' : n < 1 ? `${Math.round(n * 100)}¢` : `$${n.toFixed(2)}`

/**
 * Review with nothing open: today across both workspaces. What waits on you, the one thing to do first,
 * what agents are doing right now, what shipped, and what it all costs.
 */
export function Today({ missing = [], onSkills, me, prs, tickets, health, now, onPr, onTicket, focus }: {
  focus?: string; missing?: string[]; onSkills?: () => void; me?: string; prs: PrView[]; tickets: TicketView[]; health?: Health; now: number
  onPr: (id: string) => void; onTicket: (id: string) => void
}) {
  const held = useHeld()
  const open = prs.filter((p) => !p.closed)
  const queue: Item[] = [
    ...tickets.filter((t) => groupOf(t).id === 'needs-you').map((t) => ({ key: t.id, kind: 'ticket' as const, id: t.id, ref: t.id, title: t.title, what: ticketWhat(t), at: t.updatedAt, repo: t.repo })),
    ...open.filter(waiting).map((p) => ({ key: p.id, kind: 'pr' as const, id: p.id, ref: `#${p.number}`, title: p.title, what: prWhat(p), at: p.updatedAt, repo: p.repo })),
    ...tickets.filter((t) => groupOf(t).id === 'tend').map((t) => ({ key: t.id, kind: 'ticket' as const, id: t.id, ref: t.id, title: t.title, what: ticketWhat(t), at: t.updatedAt, repo: t.repo })),
  ]
  const working = [
    ...open.filter((p) => p.status === 'preparing' || p.status === 'posting' || p.status === 'queued').map((p) => ({ key: p.id, go: () => onPr(p.id), ref: `#${p.number}`, title: p.title, what: p.status === 'queued' ? 'queued' : p.mine ? 'revising' : 'reviewing', repo: p.repo })),
    ...tickets.filter((t) => t.busy).map((t) => ({ key: t.id, go: () => onTicket(t.id), ref: t.id, title: t.title, what: t.run?.state === 'queued' ? 'queued' : 'shipping', repo: t.repo })),
  ]
  const shipped = tickets.filter((t) => groupOf(t).id === 'shipped')
  const go = (i: Item) => (i.kind === 'pr' ? onPr(i.id) : onTicket(i.id))
  const first = queue[0]
  const perReview = avg(prs.filter((p) => !p.mine).map((p) => p.job?.costUsd))
  const perTicket = avg(tickets.map((t) => t.run?.costUsd))
  const hour = new Date(now).getHours()

  return (
    <div className="h-full overflow-y-auto px-6 py-8 lg:px-10 2xl:px-16">
      <div className="mx-auto max-w-4xl space-y-8">
        <header>
          <h1 className="text-display font-semibold tracking-tight text-fg-1 ">{hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}{me ? `, ${me.split(' ')[0]}` : ''}</h1>
          <p className="mt-1 text-body text-fg-3">
            {queue.length ? `${queue.length} thing${queue.length === 1 ? '' : 's'} wait on you` : 'Nothing waits on you'}
            {working.length ? ` · ${working.length} agent${working.length === 1 ? '' : 's'} at work` : ''}
            {shipped.length ? ` · ${shipped.length} shipped, green and quiet` : ''}
            <span className="ml-2 text-fg-3">· <kbd className="rounded-chip border border-line-strong px-1 font-mono text-micro">⌘K</kbd> to jump anywhere</span>
          </p>
        </header>

        {missing.length > 0 && (
          <button onClick={onSkills} className="flex w-full items-center gap-3 rounded-card bg-fail/7 px-4 py-3 text-left text-body ring-1 ring-fail/20 transition-colors hover:bg-fail/10">
            <TriangleAlert className="size-4 shrink-0 text-fail-text" />
            <span className="min-w-0 flex-1 text-fg-2 "><span className="font-semibold">{missing.length} skill{missing.length === 1 ? '' : 's'} your settings run {missing.length === 1 ? 'is' : 'are'} missing on this machine:</span> {missing.map((m) => `/${m}`).join(', ')}. Runs that need {missing.length === 1 ? 'it' : 'them'} will fail.</span>
            <span className="shrink-0 text-small font-medium text-fail-text">See skills</span>
          </button>
        )}

        {first ? (
          <button onClick={() => go(first)}
                  className="group flex w-full items-center gap-4 rounded-panel bg-gradient-to-br from-accent to-accent p-5 text-left text-white transition-all hover:-translate-y-0.5">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-card bg-white/15"><Sparkles className="size-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-small font-semibold text-white/70">Do this first · {first.what}</span>
              <span className="mt-0.5 block truncate text-title font-semibold"><span className="font-mono text-white/70">{first.ref}</span> {first.title}</span>
            </span>
            <ArrowRight className="size-5 shrink-0 transition-transform group-hover:translate-x-1" />
          </button>
        ) : (
          <div className="flex items-center gap-4 rounded-panel bg-ok/7 p-5 ring-1 ring-ok/20">
            <CircleCheck className="size-6 text-ok-text" />
            <p className="text-reading text-fg-2 ">{focus && !prs.length && !tickets.length ? <>Nothing in <span className="font-mono">{focus}</span> yet: no PRs, and no tickets or issues assigned to you. They show up here as they arrive.</> : 'You are clear. New review requests and feedback land here as they arrive.'}</p>
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          <Section icon={ListTodo} title="Waiting on you" n={queue.length}>
            {queue.slice(1, 8).map((i) => (
              <Row key={i.key} onClick={() => go(i)} ref_={i.ref} title={i.title} meta={<>{i.what} · {ago(i.at, now)}</>} held={i.repo ? held[i.repo] : undefined} />
            ))}
            {queue.length <= 1 && <Empty>{queue.length ? 'Only the one above.' : 'Nothing.'}</Empty>}
          </Section>
          <Section icon={LoaderCircle} spin={working.length > 0} title="Agents at work" n={working.length}>
            {working.slice(0, 7).map((w) => <Row key={w.key} onClick={w.go} ref_={w.ref} title={w.title} meta={w.what} held={w.repo ? held[w.repo] : undefined} />)}
            {!working.length && <Empty>Idle. Runs you start show up here.</Empty>}
          </Section>
          <Section icon={GitPullRequest} title="Shipped, waiting for review" n={shipped.length}>
            {shipped.slice(0, 5).map((t) => <Row key={t.id} onClick={() => onTicket(t.id)} ref_={t.id} title={t.title} meta={t.prs.length > 1 ? `${t.prs.length} PRs, CI green` : 'CI green, no threads'} held={t.repo ? held[t.repo] : undefined} />)}
            {!shipped.length && <Empty>Nothing yet.</Empty>}
          </Section>
          <Section icon={Coins} title="What it costs">
            <dl className="grid grid-cols-3 gap-3 px-1 py-1">
              <Stat label="Today" value={usd(health?.spentToday)} sub={health?.settings.dailyBudgetUsd ? `of $${health.settings.dailyBudgetUsd}` : 'no cap'} />
              <Stat label="Per review" value={usd(perReview)} sub="on average" />
              <Stat label="Per ticket" value={usd(perTicket)} sub="on average" />
            </dl>
          </Section>
        </div>
      </div>
    </div>
  )
}

function Section({ icon: Icon, spin, title, n, children }: { icon: typeof ListTodo; spin?: boolean; title: string; n?: number; children: React.ReactNode }) {
  return (
    <section className="rounded-card bg-white/70 p-2 ring-1 ring-line dark:bg-zinc-900/40 ">
      <h2 className="flex items-center gap-1.5 px-2 pb-1.5 pt-1 text-small font-semibold text-fg-3">
        <Icon className={`size-3.5 text-fg-3 ${spin ? 'animate-spin' : ''}`} />{title}{n != null && <span className="tabular-nums text-fg-3">{n}</span>}
      </h2>
      {children}
    </section>
  )
}
// held: no machine can work on its application now (held.ts): dimmed, still opened to read
const Row = ({ onClick, ref_, title, meta, held }: { onClick: () => void; ref_: string; title: string; meta: React.ReactNode; held?: string }) => (
  <button onClick={onClick} data-held={held ? true : undefined} title={held ? `Actions off: ${held}` : undefined} className="flex w-full flex-col rounded-ctl px-2 py-1.5 text-left transition-colors hover:bg-hover">
    <span className="flex gap-2 text-body"><span className="shrink-0 font-mono text-fg-3">{ref_}</span><span className="truncate text-fg-2 ">{title}</span></span>
    <span className="text-meta text-fg-3">{meta}</span>
  </button>
)
const Empty = ({ children }: { children: React.ReactNode }) => <p className="px-2 py-1.5 text-small text-fg-3">{children}</p>
const Stat = ({ label, value, sub }: { label: string; value: string; sub: string }) => (
  <div><dt className="text-meta text-fg-3">{label}</dt><dd className="text-title font-semibold tabular-nums text-fg-1 ">{value}</dd><dd className="text-meta text-fg-3">{sub}</dd></div>
)
