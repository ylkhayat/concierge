// A page of the thread's parts with made-up data, for looking at them without a server (the dev server only:
// npx vite --config dev/preview/vite.config.mjs, then /?gallery). Never in a build.
import { ShippingVital, Vitals } from '../thread/Vitals.tsx'
import { CardDiagram } from '../thread/CardDiagram.tsx'
import { LinkedPills } from '../components/Linked.tsx'
import { MessageCircleQuestion } from 'lucide-react'
import { NextSteps } from '../components/NextSteps.tsx'
import { Composer, NextCard, ThreadHeader, ThreadLayout, WorkingBar } from '../ui/Thread.tsx'
import { ActivityFeed } from '../components/ActivityFeed.tsx'
import type { Activity } from '../lib.ts'

const said = Array.from({ length: 6 }, (_, i) => `**Finding ${i + 1}.** The reporter's export never reached the server: the last 30 days show one upload attempt, from the desktop app, and it was retried until it timed out. Nothing in the web app shows where it went.`)

// /?gallery=chat: a conversation in the chat column (&live: its last run still going, with background tasks; the mock
// answers /gallery/run/background with MOCK_BG=1)
const q = new URLSearchParams(location.search)
const chat = q.get('gallery') === 'chat', live = q.has('live')
const ago = (m: number) => new Date(Date.now() - m * 60e3).toISOString()
const feed: Activity[] = [
  { at: ago(90), kind: 'section', text: 'Review' },
  { at: ago(90), kind: 'event', text: 'Plan', plan: { by: 'rules', env: 'prod', skills: [{ name: 'concierge-review', why: 'reviews a PR end to end, with the checks a reviewer would run first' }], steps: ['Read the diff and the ticket', 'Run the export tests', 'Write up the findings'] } },
  { at: ago(89), kind: 'tool', tool: 'Bash', text: 'git diff origin/main...HEAD --stat' },
  { at: ago(88), kind: 'text', text: said[0] },
  { at: ago(80), kind: 'result', text: said[1], costUsd: 0.42 },
  { at: ago(40), kind: 'section', text: 'Your reply' },
  { at: ago(40), kind: 'you', text: 'Run the long export suite against the staging bucket and tell me which retries fail.' },
  { at: ago(39), kind: 'tool', tool: 'Bash', text: 'npm run test:exports -- --bucket staging-exports-eu-west-1 --retries 3 --reporter verbose' },
  { at: ago(38), kind: 'event', text: 'Its turn ended with 3 tasks still running in the background; it goes on once they finish.', items: [
    { label: 'The long export suite against the staging bucket, every retry logged to a file it tails', detail: 'npm run test:exports -- --bucket staging-exports-eu-west-1 --retries 3 --reporter verbose > /tmp/exports-suite-with-a-very-long-name.log 2>&1' },
    { label: 'A subagent reading the upload service logs for the last 30 days' },
    { label: 'Tail', detail: 'tail -f /tmp/exports-suite-with-a-very-long-name.log' }] },
  { at: ago(30), kind: 'text', text: said[2] },
  { at: ago(29), kind: 'you', lane: 'intent', text: 'Does the toast need a link at all?' },
  ...(live ? [{ at: ago(1), kind: 'tool', tool: 'Read', text: '/tmp/exports-suite-with-a-very-long-name.log' } as Activity] : [{ at: ago(20), kind: 'result', text: said[3], costUsd: 0.9 } as Activity]),
]

export function Gallery() {
  const toast = (m: string) => console.log(m)
  const steer = <NextSteps stepper nextUrl="/gallery/next" replyUrl="/gallery/reply" draft="gallery" version="1" toast={toast} route={{ send: async () => {} }} commands={[{ id: 'run', group: 'Next', label: 'Run it again', hint: 'Start the exec command on it. Stack re-runs the tickets of its last run together, in order', run: () => {} }, { id: 'ticket', group: 'Read', label: 'Read AC-1462', run: () => {} }, { id: 'pr', group: 'Open', label: 'Open #2028 in Review', hint: 'User Feedback: Missing meeting summary', run: () => {} }, { id: 'linear', group: 'Open', label: 'Open in Linear', run: () => {} }]} />
  return (
    <div className="h-[100dvh] bg-bg-app text-fg-1">
      <ThreadLayout
        header={<ThreadHeader crumb={<span className="flex items-center gap-1.5"><LinkedPills onOpen={() => {}} linked={[{ kind: 'ticket', id: 'AI-1447', label: 'AI-1447', title: 'GPT-Live parity', url: 'https://linear.app/x', agent: 'asks' }, { kind: 'pr', id: 'r#5456', label: '#5456', title: 'feat', url: 'https://github.com/x', agent: 'working' }]} />AC-1492</span>} title="Exports fail to save after a long upload" />}
        tabs={[{ id: 'ticket', label: 'Ticket' }]} tab="ticket" onTab={() => {}}
        pane={<div className="space-y-6 p-5" style={{ '--lane': 'var(--vital-understanding)' } as React.CSSProperties}>
          <CardDiagram d={{ kind: 'path', before: 'Export lost after long upload', after: 'Saved, with a link in the toast', steps: [
            { label: 'Export button', file: 'src/export/Button.tsx', detail: 'Starts the upload and keeps the job id.' },
            { label: 'uploadExport', file: 'src/export/upload.ts', detail: 'Streams the file in chunks and retries a dropped chunk three times.' },
            { label: 'POST /exports', file: 'server/routes/exports.ts', detail: 'Stores the file and returns where it went.' },
            { label: 'Saved toast', file: 'src/export/toast.tsx', detail: 'Shows the link to the saved export.' }] }} />
          <div style={{ '--lane': 'var(--vital-intent)' } as React.CSSProperties}>
            <CardDiagram d={{ kind: 'fork', problem: 'Reporters think long exports vanish', chosen: { label: 'Link in the toast', why: 'It answers where the export went, where they look.' },
              setAside: [{ label: 'Email when done', why: 'Slow, and most exports finish in a minute.' }, { label: 'Exports page', why: 'A new page for one link.' }], open: ['Keep exports for how long?'] }} />
          </div>
        </div>}
        vitals={(
          <Vitals shipping={<ShippingVital title="The agent asks you" tone="wait" at={2} why="It confirmed the export is saved and needs a decision on the ticket." />}
                  topics={{ target: 'x', onChange: () => {}, onSteer: async () => {}, toast: () => {}, d: { intent: { target: 'x', topic: 'intent', messages: [{ who: 'you', text: 'q', at: '' }], stage: 'converging', status: '1 open question', summary: 'Agreed: the desktop app saved the export; the bug is that the reporter was never shown where it is.', costUsd: 0.12,
                    steer: 'Add a link to the saved export in the toast.', adr: { title: 'Show where the export went', status: 'proposed', context: 'Reporters believe exports are lost.', decision: 'The toast links to the saved export.', consequences: 'One more surface to keep in sync.' }, actions: [{ kind: 'ask-author', label: 'Ask the reporter which account they used' }] },
                    understanding: { target: 'x', topic: 'understanding', messages: [], stage: 'new', status: '', summary: '', costUsd: 0 } } }} />
        )}
        next={chat && live ? <WorkingBar title="The agent is working" sub="3 running in the background" stop={() => {}}>{steer}</WorkingBar> : <NextCard icon={MessageCircleQuestion} tone="wait" title="The agent asks you" actions={steer} />}
        composer={chat ? <Composer><NextSteps stepper replyUrl="/gallery/reply" draft="gallery-box" version="" toast={toast} placeholder="Tell it something while it works" /></Composer> : undefined}
        follow={chat ? feed.length : undefined}
      >
        {chat ? <ActivityFeed feed={feed} live={live} bg={{ base: '/gallery/run', count: 3 }} toast={toast} /> : <>
        <ul className="flex flex-col gap-4">
          <li className="lane lane-intent ml-auto max-w-[85%]"><p className="mb-0.5 text-micro font-semibold text-wait-text">Intent <span className="font-normal text-fg-4">you asked</span></p><p className="text-body text-fg-1">Should the reporter have seen the export at all?</p></li>
          <li className="lane lane-intent"><p className="mb-0.5 text-micro font-semibold text-wait-text">Intent <span className="font-normal text-fg-4">answered</span></p><p className="text-body leading-relaxed text-fg-2">Yes: the ticket says an export should end one click away from the file. Nothing in the app shows where it was saved, so the intent is not met even though the save works.</p></li>
          <li className="lane lane-understanding"><p className="mb-0.5 text-micro font-semibold text-run-text">Understanding <span className="font-normal text-fg-4">answered</span></p><p className="text-body leading-relaxed text-fg-2">The desktop app uploads the export, then opens a browser tab that never loads it: that tab is the only pointer to it.</p></li>
        </ul>
        {said.slice(0, 2).map((t, i) => <p key={i} className="text-body leading-relaxed text-fg-2" dangerouslySetInnerHTML={{ __html: t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>') }} />)}
        </>}
      </ThreadLayout>
    </div>
  )
}
