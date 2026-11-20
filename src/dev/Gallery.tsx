// A page of the thread's parts with made-up data, for looking at them without a server (the dev server only:
// npx vite --config dev/preview/vite.config.mjs, then /?gallery). Never in a build.
import { ShippingVital, Vitals } from '../thread/Vitals.tsx'
import { CardDiagram } from '../thread/CardDiagram.tsx'
import { LinkedPills } from '../components/Linked.tsx'
import { MessageCircleQuestion } from 'lucide-react'
import { NextSteps } from '../components/NextSteps.tsx'
import { NextCard, ThreadHeader, ThreadLayout } from '../ui/Thread.tsx'

const said = Array.from({ length: 6 }, (_, i) => `**Finding ${i + 1}.** The reporter's export never reached the server: the last 30 days show one upload attempt, from the desktop app, and it was retried until it timed out. Nothing in the web app shows where it went.`)

export function Gallery() {
  const toast = (m: string) => console.log(m)
  const steer = <NextSteps stepper inline nextUrl="/gallery/next" replyUrl="/gallery/reply" draft="gallery" version="1" toast={toast} route={{ send: async () => {} }} commands={[{ id: 'run', group: 'Next', label: 'Run it again', hint: 'Start the exec command on it. Stack re-runs the tickets of its last run together, in order', run: () => {} }, { id: 'ticket', group: 'Read', label: 'Read AC-1462', run: () => {} }, { id: 'pr', group: 'Open', label: 'Open #2028 in Review', hint: 'User Feedback: Missing meeting summary', run: () => {} }, { id: 'linear', group: 'Open', label: 'Open in Linear', run: () => {} }]} />
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
        next={<NextCard icon={MessageCircleQuestion} tone="wait" title="The agent asks you" actions={steer} />}
      >
        <ul className="flex flex-col gap-4">
          <li className="lane lane-intent ml-auto max-w-[85%]"><p className="mb-0.5 text-micro font-semibold text-wait-text">Intent <span className="font-normal text-fg-4">you asked</span></p><p className="text-body text-fg-1">Should the reporter have seen the export at all?</p></li>
          <li className="lane lane-intent"><p className="mb-0.5 text-micro font-semibold text-wait-text">Intent <span className="font-normal text-fg-4">answered</span></p><p className="text-body leading-relaxed text-fg-2">Yes: the ticket says an export should end one click away from the file. Nothing in the app shows where it was saved, so the intent is not met even though the save works.</p></li>
          <li className="lane lane-understanding"><p className="mb-0.5 text-micro font-semibold text-run-text">Understanding <span className="font-normal text-fg-4">answered</span></p><p className="text-body leading-relaxed text-fg-2">The desktop app uploads the export, then opens a browser tab that never loads it: that tab is the only pointer to it.</p></li>
        </ul>
        {said.slice(0, 2).map((t, i) => <p key={i} className="text-body leading-relaxed text-fg-2" dangerouslySetInnerHTML={{ __html: t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>') }} />)}
      </ThreadLayout>
    </div>
  )
}
