// One machine, by default: everything runs here, and nothing else needs asking. An extension can make this one of
// several machines that take turns: set CONCIERGE_FLEET to a module whose default export fills in some of Fleet.
// Loaded before the state (store.ts imports this), so it must find its own paths.
export type Fleet = {
  elsewhere(): string | undefined // another machine runs it now: its name. Nothing new starts here meanwhile
  mayWrite(): boolean // this machine may save its state
  whyNot?(): string | undefined // when it may not: why, in a sentence (the lease unreadable, the other machine holds it…)
  machine?: string // this machine's name, among several
  reach?: { from: string; to: string } // a page opened at <from>… reaches this machine at <to>… (a shared link)
  view?(): Promise<Record<string, unknown>> // the machines, for Settings → About
  watch?(raise: (id: string, title: string, text?: string) => void): void // its own alerts, raised and cleared
}

const single: Fleet = { elsewhere: () => undefined, mayWrite: () => true }
async function load(): Promise<Fleet> {
  const from = process.env.CONCIERGE_FLEET
  if (!from) return single
  try { return { ...single, ...(await import(from)).default } } catch (e) {
    console.error(`fleet: can't load ${from} (${(e as Error).message}); going on as one machine`)
    return single
  }
}
export const fleet: Fleet = await load()
