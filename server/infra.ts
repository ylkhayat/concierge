// Where it runs, as Settings → About shows it: the commit running here and since when, and, when an extension makes
// this one of several machines (fleet.ts), those machines and how they keep in step.
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fleet } from './fleet.ts'
import { DB_FILE, STATE_DIR } from './store.ts'
import { replicaStatus } from './replica.ts'

type Beat = { name: string; role?: string; active?: boolean; handing?: boolean; seq?: number; agoS?: number }
type Machines = {
  machine?: string; role?: string; peer?: string; beats: Beat[]; conflicts: string[]
}

export async function infraView() {
  const deployed = (await readFile(join(STATE_DIR, `deployed${fleet.machine ? `.${fleet.machine}` : ''}`), 'utf8').catch(() => '')).trim().slice(0, 7) || undefined
  return {
    version: deployed, startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    stateBytes: (await stat(DB_FILE).catch(() => undefined))?.size,
    beats: [], conflicts: [],
    ...(await fleet.view?.() as Partial<Machines> | undefined),
    // how this machine keeps in step with the one holding the lease (replica.ts)
    replica: fleet.machine ? replicaStatus() : undefined,
  } as { version?: string; startedAt: string; stateBytes?: number; replica?: ReturnType<typeof replicaStatus> } & Machines
}
export type InfraView = Awaited<ReturnType<typeof infraView>>
