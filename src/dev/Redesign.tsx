// The redesign, as a page to react to before the app changes (dev only: /?gallery=next). Made-up data, real kit
// (src/kit): one column per item, tabs across the top, and one dock at the bottom for whatever needs you.
import { ArrowRight, GitPullRequest, Send, Upload } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, CheckRow, Dock, Field, ListGroup, ListRow, Segmented, Status, Tabs, Tag } from '../kit/index.tsx'

type Role = 'developer' | 'product'
type Tab = 'conversation' | 'explain' | 'description' | 'stack' | 'changes' | 'plan'
const STEPS = [
  { text: 'Push the 2 fix commits to #218', note: 'the branch is ahead of the PR by two commits', pub: true, on: true },
  { text: 'Post the 3 drafted replies', note: 'the reviewer’s thread may change after the push', pub: true, on: false },
  { text: 'Add a test for an export that times out', on: true },
]
const STACK = [
  { pr: '#216', title: 'Shared export state', steps: ['Push the rename to #216'] },
  { pr: '#217', title: 'Exports resume after a dropped upload', steps: ['Rebase onto the new #216', 'Force-push with lease'] },
]

export function Redesign() {
  const [role, setRole] = useState<Role>('developer')
  const [tab, setTab] = useState<Tab>('conversation')
  // the dock is open where you answer (Conversation), and one line on the reading tabs until you open it
  const [openOn, setOpenOn] = useState<Record<string, boolean>>({})
  const [pick, setPick] = useState<number>()
  const [ticks, setTicks] = useState(STEPS.map((s) => s.on))
  const [text, setText] = useState('')
  const dev = role === 'developer'
  const tabs: { id: Tab; label: string; count?: number }[] = dev
    ? [{ id: 'conversation', label: 'Conversation' }, { id: 'explain', label: 'Explain' }, { id: 'description', label: 'Description' }, { id: 'stack', label: 'Stack', count: 2 }]
    : [{ id: 'changes', label: 'What changes' }, { id: 'conversation', label: 'Conversation' }, { id: 'plan', label: 'In the plan' }]
  const cur = tabs.some((t) => t.id === tab) ? tab : tabs[0].id
  const going = ticks.filter(Boolean).length
  const open = openOn[`${role}:${cur}`] ?? cur === 'conversation'
  const setOpen = (f: (o: boolean) => boolean) => setOpenOn((x) => ({ ...x, [`${role}:${cur}`]: f(open) }))

  return (
    <div className="flex h-[100dvh] bg-bg-app text-fg-1">
      {/* the list: what needs you first, always the same four groups */}
      <aside className="flex w-[320px] shrink-0 flex-col border-r border-line">
        <div className="flex items-center gap-2 px-4 pb-2 pt-4">
          <h1 className="flex-1 text-title font-semibold tracking-tight">{dev ? 'Review' : 'Product'}</h1>
          <Segmented label="Role" value={role} onChange={(r) => { setRole(r); setTab(r === 'developer' ? 'conversation' : 'changes') }} options={[{ id: 'developer', label: 'Dev' }, { id: 'product', label: 'PM' }]} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          <ListGroup label="Needs you" count={2} />
          <ListRow on tone="wait" title="Exports fail to save after a long upload" meta={<><span className="font-mono">#218</span><span>asks you · 3 steps</span></>} />
          <ListRow tone="wait" title="Exports resume after a dropped upload" meta={<><span className="font-mono">#217</span><span>1 decision</span></>} />
          <ListGroup label="Working" count={1} />
          <ListRow tone="run" pulse title="Shared export state" meta={<><span className="font-mono">#216</span><span>self-review · 4 min</span></>} />
          <ListGroup label="Waiting on others" count={2} />
          <ListRow tone="neutral" title="Seat pausing: billing from the next cycle" meta={<><span className="font-mono">#209</span><span>review requested · 1d</span></>} />
          <ListRow tone="neutral" title="Paused members keep their data" meta={<><span className="font-mono">#204</span><span>CI running</span></>} />
          <ListGroup label="Done" count={1} />
          <ListRow tone="ok" title="Owner can’t pause their own seat" meta={<><span className="font-mono">#201</span><span>approved · ready to merge</span></>} />
        </div>
      </aside>

      {/* the item: header, tabs, one full-width view, and the dock */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="space-y-2.5 px-6 pb-3 pt-4">
          <div className="flex items-center gap-2"><Tag mono>AC-1492</Tag><Tag mono>app#218</Tag><span className="flex-1" /><Button kind="ghost" icon={GitPullRequest}>GitHub</Button></div>
          <h2 className="text-display font-semibold tracking-tight">Exports fail to save after a long upload</h2>
          {/* where it stands, in the three things that decide whether to trust it */}
          <div className="flex flex-wrap items-center gap-2">
            <Status tone="wait">Shipping · the agent asks you</Status>
            <Status tone={dev ? 'ok' : 'wait'}>{dev ? 'Intent · record agreed' : 'Intent · 1 open question'}</Status>
            <Status tone="neutral">Understanding · not assessed</Status>
            <span className="text-meta text-fg-3">5 files · +52 −12 · CI green</span>
          </div>
        </header>
        <Tabs tabs={tabs} value={cur} onChange={setTab} />

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={`mx-auto space-y-4 px-6 py-5 ${cur === 'explain' ? 'max-w-[1100px]' : 'max-w-[860px]'}`}>
            {cur === 'conversation' && <>
              <p className="text-meta text-fg-4">Today, 14:02 · Revise · 6 min · $0.84</p>
              <div className="space-y-1"><p className="text-micro font-semibold text-fg-3">You</p><p className="text-body">The reviewer says a long upload still loses the export. Check it against the upload timeout.</p></div>
              <p className="text-small text-fg-3">12 steps · read 4 files, ran 1 test</p>
              <div className="space-y-2"><p className="text-micro font-semibold text-accent-text">Agent</p>
                <p className="text-body leading-relaxed">You were right: the export was saved, but the page never learned where. A long upload outlives the 30 s lookup, so the toast shows “failed” while the file is there.</p>
                <p className="text-body leading-relaxed">I committed the fix on the branch, with one test that fails without it. Nothing is pushed yet.</p></div>
            </>}
            {cur === 'explain' && <>
              <div className="flex items-center gap-3"><Segmented label="View" value="tour" onChange={() => {}} options={[{ id: 'tour', label: 'Tour' }, { id: 'business', label: 'Business' }, { id: 'technical', label: 'Technical' }, { id: 'norms', label: 'Norms' }]} /><span className="text-meta text-fg-3">Step 1 of 6</span></div>
              <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
                <Card title="Tour">{['Why this exists', 'What was done', 'Before → now', 'The lookup waits for the upload', 'Tests', 'Cleanup'].map((s, i) => <p key={s} className={`rounded-ctl px-2 py-1.5 text-small ${i === 0 ? 'bg-accent-soft font-medium text-accent-text' : 'text-fg-2'}`}>{i + 1}. {s}</p>)}</Card>
                <Card title="Why this exists" aside={<Tag>Users</Tag>}>
                  <p className="text-title font-semibold tracking-tight">A finished export looked like a failed one</p>
                  <p className="mt-2 max-w-[60ch] text-reading leading-relaxed text-fg-2">People uploading large files saw “export failed” and started again, though the file had been saved. Support saw the same report eleven times last month.</p>
                  <div className="mt-4 flex justify-end"><Button kind="primary" icon={ArrowRight}>Next</Button></div>
                </Card>
              </div>
            </>}
            {cur === 'description' && <Card title="Description"><p className="max-w-[65ch] text-reading leading-relaxed text-fg-2">Waits for the upload before looking the export up, and links the saved file in the toast. Closes AC-1492.</p></Card>}
            {cur === 'stack' && <>
              <p className="text-small text-fg-3">Two more PRs of this stack wait on you. Answer them here, or all of them at once from the dock.</p>
              {STACK.map((s) => <Card key={s.pr} title={<><span className="font-mono text-fg-3">{s.pr}</span> {s.title}</>}>{s.steps.map((x) => <CheckRow key={x} on onChange={() => {}}>{x}</CheckRow>)}</Card>)}
            </>}
            {cur === 'changes' && <>
              <Card title="For your users"><p className="text-title font-semibold tracking-tight">A finished export now says where it is</p><p className="mt-2 max-w-[60ch] text-reading leading-relaxed text-fg-2">After a long upload, people see a link to the saved export instead of “failed”. Nothing changes for short uploads.</p></Card>
              <div className="grid gap-4 md:grid-cols-2">
                <Card title="The journey">{['Uploads a large file', 'Export is saved', 'Sees where it is'].map((s, i) => <p key={s} className="flex items-center gap-2 py-1 text-small text-fg-2"><span className={`size-1.5 rounded-full ${i === 2 ? 'bg-ok' : 'bg-fg-4'}`} />{s}{i === 2 && <Tag>changed</Tag>}</p>)}</Card>
                <Card title="Who notices">{[['People uploading large files', 'see the link instead of “failed”'], ['Support', 'eleven fewer reports a month'], ['Everyone else', 'nothing changes']].map(([who, what]) => <p key={who} className="py-1 text-small text-fg-2"><span className="font-medium text-fg-1">{who}</span> {what}</p>)}</Card>
              </div>
            </>}
            {cur === 'plan' && <Card title="Export reliability · 2 of 5 shipped" aside={<Status tone="ok">fits the 3-week appetite</Status>}><p className="text-small text-fg-2">This ticket is the third of five. Next: resuming an export after a dropped upload.</p></Card>}
          </div>
        </div>

        {/* the dock: the same on every tab, the only place that asks for you */}
        {dev ? (
          <Dock tone="wait" title="The agent asks you" summary={open ? undefined : `${going} of ${STEPS.length} steps ticked · 2 more PRs of the stack wait`} open={open} onToggle={() => setOpen((o) => !o)}>
            <div className="space-y-0.5">{STEPS.map((s, i) => <CheckRow key={s.text} on={ticks[i]} onChange={(on) => setTicks((t) => t.map((x, j) => (j === i ? on : x)))} note={s.note} tags={s.pub && <Tag>public</Tag>}>{s.text}</CheckRow>)}</div>
            <div className="mt-3"><Field value={text} onChange={setText} placeholder="Anything else, or a change of plan (optional)…" /></div>
            <div className="mt-3 flex items-center gap-2">
              <button onClick={() => setTab('stack')} className="text-meta font-medium text-accent-text hover:underline">+ 2 more PRs of the stack wait: answer all</button>
              <span className="flex-1" />
              <Button kind="primary" icon={ticks.some((on, i) => on && STEPS[i].pub) ? Upload : Send} disabled={!going && !text.trim()}>Go ahead · {going} step{going === 1 ? '' : 's'}</Button>
            </div>
          </Dock>
        ) : (
          // the same dock for product: what it asks is a product decision, never a push or a rebase
          <Dock tone="wait" title="One decision for you" summary={open ? undefined : 'Should the link also go out by email?'} open={open} onToggle={() => setOpen((o) => !o)}>
            <p className="text-small font-medium text-fg-1">Should the link also go out by email when the upload took over a minute?</p>
            <p className="mt-0.5 text-meta text-fg-3">The agent recommends not now: it adds a notification setting, which is its own ticket.</p>
            <div className="mt-2.5 flex flex-wrap gap-2">{['Not now', 'Yes, email it', 'Make it a ticket'].map((o, i) => <Button key={o} kind={pick === i ? 'primary' : 'quiet'} onClick={() => setPick(i)}>{o}</Button>)}</div>
            <div className="mt-3"><Field value={text} onChange={setText} placeholder="Why, or anything the team should know (optional)…" /></div>
            <div className="mt-3 flex justify-end"><Button kind="primary" icon={Send} disabled={pick === undefined && !text.trim()}>Send the decision</Button></div>
          </Dock>
        )}
      </main>
    </div>
  )
}
