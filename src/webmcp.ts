// Concierge's own actions, offered to the AI agent in your browser (WebMCP: Chrome's origin trial from 149; on this
// machine with chrome://flags/#enable-webmcp-testing). Gemini in Chrome can then ask what waits on you, open a PR or
// ticket, or answer an agent, from the page as it is. Nothing happens where the browser has no WebMCP.
import { useEffect, useRef } from 'react'
import { api, type PrView, type TicketView } from './lib.ts'
import { waiting } from './components/PrList.tsx'

type Tool = { name: string; description: string; inputSchema: object; execute: (input: Record<string, unknown>) => Promise<unknown> }
type ModelContext = { registerTool: (tool: Tool, opts?: { signal?: AbortSignal }) => unknown }
// document.modelContext is where Chrome's docs have it; the trial's first builds had navigator.modelContext
const context = (): ModelContext | undefined =>
  (document as unknown as { modelContext?: ModelContext }).modelContext ?? (navigator as unknown as { modelContext?: ModelContext }).modelContext

const text = (t: string) => ({ content: [{ type: 'text', text: t }] })

export function useWebMcp(live: { prs?: PrView[]; tickets: TicketView[]; openPr: (id: string) => void; openTicket: (id: string) => void }) {
  const now = useRef(live); now.current = live // the tools read the page as it is when they are called
  useEffect(() => {
    const mc = context()
    if (!mc) return
    const stop = new AbortController()
    const findPr = (ref: string) => { const n = ref.replace(/^#/, ''); return now.current.prs?.find((p) => p.id === ref || String(p.number) === n) }
    const tools: Tool[] = [
      {
        name: 'concierge_waiting',
        description: 'What waits on the user in Concierge right now: pull requests whose agent asks them something or that need their review, and tickets whose agent needs them. Read-only.',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => {
          const { prs = [], tickets } = now.current
          const p = prs.filter((x) => !x.closed && waiting(x))
            .map((x) => `PR #${x.number} (${x.repo}) "${x.title}": ${x.flow?.why ?? x.status}`)
          const t = tickets.filter((x) => x.bucket === 'needs-you').map((x) => `Ticket ${x.id} "${x.title}"`)
          return text([...p, ...t].join('\n') || 'Nothing waits on the user.')
        },
      },
      {
        name: 'concierge_open',
        description: 'Open a pull request (its number, like 5474 or #5474) or a ticket (its id, like AI-1447) in Concierge, so the user sees it.',
        inputSchema: { type: 'object', properties: { ref: { type: 'string', description: 'A PR number (#5474) or a ticket id (AI-1447)' } }, required: ['ref'] },
        execute: async ({ ref }) => {
          const r = String(ref ?? '')
          const t = now.current.tickets.find((x) => x.id.toUpperCase() === r.toUpperCase())
          if (t) { now.current.openTicket(t.id); return text(`Opened ticket ${t.id}.`) }
          const p = findPr(r)
          if (p) { now.current.openPr(p.id); return text(`Opened PR #${p.number}: ${p.title}`) }
          return text(`No PR or ticket "${r}" in Concierge.`)
        },
      },
      {
        name: 'concierge_reply',
        description: 'Send the user\'s words to the coding agent of a pull request, exactly as the user asked (only when the user asked for it). The agent reads them between its steps, or starts a run with them.',
        inputSchema: { type: 'object', properties: { pr: { type: 'string', description: 'The PR number, like 5474' }, text: { type: 'string', description: 'What to tell the agent, in the user\'s words' } }, required: ['pr', 'text'] },
        execute: async ({ pr, text: words }) => {
          const p = findPr(String(pr ?? ''))
          if (!p) return text(`No PR "${pr}" in Concierge.`)
          const said = String(words ?? '').trim()
          if (!said) return text('Nothing to send.')
          const r = await api(`/prs/${encodeURIComponent(p.id)}/reply`, { text: said }) as { sent?: string }
          return text(`Sent to the agent on #${p.number}${r.sent ? ` (${r.sent})` : ''}.`)
        },
      },
    ]
    for (const t of tools) { try { mc.registerTool(t, { signal: stop.signal }) } catch (e) { console.warn('webmcp:', t.name, (e as Error).message) } }
    return () => stop.abort()
  }, [])
}
