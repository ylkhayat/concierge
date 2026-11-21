// One live connection for every Concierge tab (a SharedWorker): it holds the event stream, keeps the latest PR list,
// board, health and alerts (applying their patches as they come), relays every event to each tab, and hands a tab that
// opens what is current at once, instead of each tab downloading it all and streaming on its own.
type Port = MessagePort
const ports = new Set<Port>()
let open = false
let prs: { id: string }[] | undefined, exec: { tickets: { id: string }[] } | undefined
let health: string | undefined, alerts: string | undefined
const send = (msg: { type: string; data?: string }) => { for (const p of ports) p.postMessage(msg) }
// what a patch says, onto the list it patches (the same as the tabs do: lib.ts)
const patch = <T extends { id: string }>(list: T[], d: { set: T[]; del: string[]; order: string[] }) => {
  const byId = new Map(list.map((x) => [x.id, x]))
  for (const id of d.del) byId.delete(id)
  for (const x of d.set) byId.set(x.id, x)
  return d.order.map((id) => byId.get(id)).filter((x): x is T => !!x)
}

const es = new EventSource('/api/events')
es.onopen = () => { open = true; send({ type: 'open' }) }
es.onerror = () => { open = false; send({ type: 'error' }) }
for (const name of ['prs', 'prs-patch', 'exec', 'exec-patch', 'health', 'alerts', 'activity', 'stale']) {
  es.addEventListener(name, (e) => {
    const data = (e as MessageEvent<string>).data
    if (name === 'prs') prs = JSON.parse(data)
    else if (name === 'prs-patch' && prs) prs = patch(prs, JSON.parse(data))
    else if (name === 'exec') exec = JSON.parse(data)
    else if (name === 'exec-patch' && exec) { const d = JSON.parse(data); exec = { ...exec, ...d.meta, tickets: patch(exec.tickets, d) } }
    else if (name === 'health') health = data
    else if (name === 'alerts') alerts = data
    send({ type: name, data })
  })
}

;(self as unknown as { onconnect: (e: MessageEvent) => void }).onconnect = (e) => {
  const port = e.ports[0]
  ports.add(port)
  port.onmessage = (m) => { if (m.data === 'bye') ports.delete(port) }
  port.start()
  // what is current, at once: the new tab starts where the others are
  if (open) port.postMessage({ type: 'open' })
  if (prs) port.postMessage({ type: 'prs', data: JSON.stringify(prs) })
  if (exec) port.postMessage({ type: 'exec', data: JSON.stringify(exec) })
  if (health) port.postMessage({ type: 'health', data: health })
  if (alerts) port.postMessage({ type: 'alerts', data: alerts })
}
