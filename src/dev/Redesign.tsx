// The redesign, as a page to react to before the app changes (dev only: /?gallery=next). Made-up data, real kit
// (src/kit). Two screens, both overviews: the board (everything in flight, answered in place: no click to open what
// needs you) and an item (every facet visible at once as panels; depth opens in place, never behind a tab).
import { ArrowLeft, ChevronDown, GitPullRequest, Send, Upload } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button, Card, CheckRow, Field, Segmented, Status, Tag } from '../kit/index.tsx'

type Role = 'developer' | 'product'
const STEPS = [
  { text: 'Push the 2 fix commits to #218', pub: true, on: true },
  { text: 'Post the 3 drafted replies', pub: true, on: false, note: 'the reviewer’s thread may change after the push' },
  { text: 'Add a test for an export that times out', on: true },
]

/** What an agent asks, answerable wherever it shows: the board's card and the item's first panel are this same part. */
function Ask({ role, compact }: { role: Role; compact?: boolean }) {
  const [ticks, setTicks] = useState(STEPS.map((s) => s.on))
  const [pick, setPick] = useState<number>(0)
  const [text, setText] = useState('')
  const [more, setMore] = useState(false)
  const going = ticks.filter(Boolean).length
  if (role === 'product') return (
    <div className="space-y-2.5">
      <p className="text-small font-medium text-fg-1">Should the link also go out by email when the upload took over a minute?</p>
      <div className="flex flex-wrap gap-1.5">{['Not now', 'Yes, email it', 'Make it a ticket'].map((o, i) => <Button key={o} kind={pick === i ? 'primary' : 'quiet'} onClick={() => setPick(i)}>{o}{i === 0 && pick !== 0 ? ' · agent’s pick' : ''}</Button>)}</div>
      {(more || !compact) && <Field value={text} onChange={setText} placeholder="Why, or anything the team should know (optional)…" />}
      <div className="flex items-center gap-2">{compact && !more && <button onClick={() => setMore(true)} className="text-meta text-fg-3 hover:text-fg-1">Add a note</button>}<span className="flex-1" /><Button kind="primary" icon={Send}>Send the decision</Button></div>
    </div>
  )
  return (
    <div className="space-y-2">
      <div className="-mx-2">{STEPS.map((s, i) => <CheckRow key={s.text} on={ticks[i]} onChange={(on) => setTicks((t) => t.map((x, j) => (j === i ? on : x)))} note={compact ? undefined : s.note} tags={s.pub && <Tag>public</Tag>}>{s.text}</CheckRow>)}</div>
      {(more || !compact) && <Field value={text} onChange={setText} placeholder="Anything else, or a change of plan (optional)…" />}
      <div className="flex items-center gap-2">{compact && !more && <button onClick={() => setMore(true)} className="text-meta text-fg-3 hover:text-fg-1">Add a note</button>}<span className="flex-1" /><Button kind="primary" icon={ticks.some((on, i) => on && STEPS[i].pub) ? Upload : Send} disabled={!going}>Go ahead · {going}</Button></div>
    </div>
  )
}

const Col = ({ label, count, tone, children }: { label: string; count: number; tone: string; children: ReactNode }) => (
  <section className="flex min-w-0 flex-col gap-2.5">
    <h2 className="flex items-center gap-2 px-1 label text-fg-3"><span className={`size-1.5 rounded-full ${tone}`} />{label}<span className="font-normal tabular-nums text-fg-4">{count}</span></h2>
    {children}
  </section>
)
/** A card of the board: what it is in two lines; its body is whatever its column needs (an answer, a progress line). */
function Item({ id, title, line, onOpen, children }: { id: string; title: string; line?: ReactNode; onOpen?: () => void; children?: ReactNode }) {
  return (
    <article className="card p-3.5">
      <button onClick={onOpen} className="block w-full text-left"><span className="font-mono text-micro text-fg-3">{id}</span><span className="mt-0.5 block text-small font-semibold leading-snug text-fg-1 hover:underline">{title}</span></button>
      {line && <p className="mt-1 text-meta text-fg-3">{line}</p>}
      {children && <div className="mt-2.5 border-t border-line pt-2.5">{children}</div>}
    </article>
  )
}

export function Redesign() {
  const [role, setRole] = useState<Role>('developer')
  const [open, setOpen] = useState(false) // an item's overview, over the board
  const [talk, setTalk] = useState(false)
  const dev = role === 'developer'
  const head = (
    <header className="flex items-center gap-3 border-b border-line px-6 py-3">
      {open && <Button kind="ghost" icon={ArrowLeft} onClick={() => setOpen(false)}>Overview</Button>}
      <h1 className="text-title font-semibold tracking-tight">{open ? 'Exports fail to save after a long upload' : 'Overview'}</h1>
      {!open && <p className="text-small text-fg-3"><b className="font-semibold text-wait-text">2 need you</b> · 1 working · 2 waiting on others · 1 ready to merge · $28.40 today</p>}
      {open && <><Tag mono>AC-1492</Tag><Tag mono>app#218</Tag></>}
      <span className="flex-1" />
      <Segmented label="Role" value={role} onChange={setRole} options={[{ id: 'developer', label: 'Dev' }, { id: 'product', label: 'PM' }]} />
    </header>
  )

  if (!open) return (
    <div className="flex h-[100dvh] flex-col bg-bg-app text-fg-1">
      {head}
      {/* the board: where everything stands, left to right; what needs you is answered on its card */}
      <div className="grid min-h-0 flex-1 grid-cols-[1.5fr_1fr_1fr_1fr] gap-5 overflow-y-auto p-6">
        <Col label="Needs you" count={2} tone="bg-wait">
          <Item id={dev ? 'app#218 · AC-1492' : 'AC-1492'} title="Exports fail to save after a long upload" onOpen={() => setOpen(true)}
                line={dev ? 'The fix is committed with a test. Nothing is pushed yet.' : 'The fix is ready. One product question is left.'}><Ask role={role} compact /></Item>
          <Item id={dev ? 'Stack · app#216 → #217' : 'AC-1488'} title="Exports resume after a dropped upload" onOpen={() => setOpen(true)}
                line={dev ? '2 PRs of this stack wait: 3 steps, 1 duplicate left out.' : 'How long should a paused upload be kept?'}>
            {dev ? <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-meta text-fg-3">Push the rename, rebase #217, force-push with lease</span><Button kind="primary" icon={Upload}>Answer the stack · 3</Button></div>
              : <div className="flex flex-wrap gap-1.5"><Button kind="primary">24 hours · agent’s pick</Button><Button>7 days</Button><Button>Until they cancel</Button></div>}
          </Item>
        </Col>
        <Col label="Working" count={1} tone="bg-run">
          <Item id="app#216" title="Shared export state" onOpen={() => setOpen(true)} line="Self-review · 4 min · $0.42"><p className="flex items-center gap-2 text-meta text-run-text"><span className="size-1.5 animate-pulse rounded-full bg-run" />Reading the reviewer’s second thread</p></Item>
        </Col>
        <Col label="Waiting on others" count={2} tone="bg-fg-4">
          <Item id="app#209" title="Seat pausing: billing from the next cycle" line="Review requested from Sam · 1 day" />
          <Item id="app#204" title="Paused members keep their data" line="CI running · 6 of 9 checks" />
        </Col>
        <Col label="Done" count={1} tone="bg-ok">
          <Item id="app#201" title="Owner can’t pause their own seat" line="Approved · CI green"><div className="flex justify-end"><Button icon={GitPullRequest}>Merge on GitHub</Button></div></Item>
        </Col>
      </div>
    </div>
  )

  return (
    <div className="flex h-[100dvh] flex-col bg-bg-app text-fg-1">
      {head}
      {/* the item: every facet on one screen; nothing behind a tab */}
      <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-12 gap-4 overflow-y-auto p-6">
        <div className="col-span-7"><Card title={dev ? 'The agent asks you' : 'One decision for you'} aside={<Status tone="wait">needs you</Status>}><Ask role={role} /></Card></div>
        <div className="col-span-5"><Card title="Where it stands">
          {[['Shipping', 'wait', dev ? 'Fix committed, not pushed' : 'Ready once you decide'], ['Intent', dev ? 'ok' : 'wait', dev ? 'Record agreed: link the saved export' : '1 open question: email or not'], ['Understanding', 'neutral', 'Not assessed yet'], ['Checks', 'ok', 'CI green · 5 files · +52 −12'], ['People', 'neutral', 'Sam commented twice · 0 of 1 approved']].map(([k, tone, v]) => (
            <p key={k} className="flex items-center gap-3 py-1.5 text-small"><span className="w-28 shrink-0 text-fg-3">{k}</span><span className={`size-1.5 shrink-0 rounded-full ${tone === 'ok' ? 'bg-ok' : tone === 'wait' ? 'bg-wait' : 'bg-fg-4'}`} /><span className="min-w-0 truncate text-fg-1">{v}</span></p>
          ))}
        </Card></div>
        <div className="col-span-7"><Card title={dev ? 'In one minute' : 'For your users'} aside={<Button kind="ghost">Take the tour · 6 steps</Button>}>
          <p className="text-title font-semibold tracking-tight">{dev ? 'A finished export looked like a failed one' : 'A finished export now says where it is'}</p>
          <p className="mt-1.5 max-w-[62ch] text-body leading-relaxed text-fg-2">{dev ? 'A long upload outlives the 30 s lookup, so the toast said “failed” while the file was saved. The lookup now waits for the upload, and the toast links the file.' : 'After a long upload, people see a link to the saved export instead of “failed”. Support saw this report eleven times last month.'}</p>
          <div className="mt-3 grid grid-cols-2 gap-3 text-small">
            <div className="rounded-xl bg-fail/8 px-3 py-2"><p className="label text-fail-text">Before</p><p className="mt-1 text-fg-2">Upload → export saved → “failed”</p></div>
            <div className="rounded-xl bg-ok/8 px-3 py-2"><p className="label text-ok-text">Now</p><p className="mt-1 text-fg-2">Upload → export saved → link to it</p></div>
          </div>
        </Card></div>
        <div className="col-span-5 space-y-4">
          <Card title="The stack" aside={<span className="text-meta text-fg-3">3 PRs · bottom first</span>}>
            {[['#216', 'Shared export state', 'bg-run', 'working'], ['#217', 'Exports resume after a dropped upload', 'bg-wait', 'asks you'], ['#218', 'Exports fail to save after a long upload', 'bg-wait', 'asks you · here']].map(([n, t, dot, st]) => (
              <p key={n} className="flex items-center gap-2.5 py-1 text-small"><span className={`size-1.5 shrink-0 rounded-full ${dot}`} /><span className="font-mono text-fg-3">{n}</span><span className="min-w-0 flex-1 truncate text-fg-1">{t}</span><span className="shrink-0 text-meta text-fg-3">{st}</span></p>
            ))}
          </Card>
          <Card title="Latest from the agent" aside={<span className="text-meta text-fg-3">14:08 · 6 min · $0.84</span>}>
            <p className="text-small leading-relaxed text-fg-2">You were right: the export was saved, but the page never learned where. I committed the fix on the branch, with one test that fails without it. Nothing is pushed yet.</p>
            <button onClick={() => setTalk((t) => !t)} className="mt-2 inline-flex items-center gap-1 text-meta font-medium text-accent-text"><ChevronDown className={`size-3.5 transition-transform ${talk ? 'rotate-180' : ''}`} />{talk ? 'Hide the conversation' : 'The whole conversation · 3 turns, 12 steps'}</button>
            {talk && <div className="mt-2 space-y-2 border-t border-line pt-2 text-small text-fg-2"><p><b className="font-semibold text-fg-1">You</b> The reviewer says a long upload still loses the export. Check it against the upload timeout.</p><p className="text-meta text-fg-3">12 steps · read 4 files, ran 1 test</p></div>}
          </Card>
        </div>
      </div>
    </div>
  )
}
