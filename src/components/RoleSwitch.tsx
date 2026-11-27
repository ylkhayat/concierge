// The mode at the head of the rail: the hat you work in. Closed, every mode you joined as a tile (one click to switch,
// the one you are in lit); open, the same side by side in one row with their names. Each mode has its own workspaces,
// colour and setup; switching swaps all of it at once. Settings → Roles adds another.
import { Plus } from 'lucide-react'
import { useEffect } from 'react'
import { useApi } from '../query.ts'
import { ready, ROLES, setRole, useRole, type Role, type RolesView } from '../role.ts'

export function RoleSwitch({ onJoin, wide }: { onJoin: () => void; wide?: boolean }) {
  const role = useRole()
  const q = useApi<RolesView>('/roles', { staleTime: 60_000 })
  const joined = ready(q.data?.joined ?? ['developer' as Role]).length ? ready(q.data?.joined ?? ['developer' as Role]) : ['developer' as Role]
  // a mode you left (on another machine): back to the first you joined
  useEffect(() => { if (q.data && !joined.includes(role)) setRole(joined[0]) }, [q.data, role]) // eslint-disable-line react-hooks/exhaustive-deps
  // closed: every mode you joined as a tile, one click to switch, the one you are in lit; the toggle under them
  if (!wide) return (
    <div role="radiogroup" aria-label="Role" className="hidden flex-col items-center gap-1.5 py-1 md:flex">
      {joined.map((r) => {
        const x = ROLES[r], on = r === role
        return (
          <button key={r} role="radio" aria-checked={on} onClick={() => !on && setRole(r)} title={on ? `You work as ${x.label}` : `Switch to ${x.label}`}
                  className="group relative flex flex-col items-center gap-0.5">
            {on && <span aria-hidden className="absolute -left-[11px] top-1.5 h-6 w-1 rounded-r-full bg-accent" />}
            <span data-role-tile={r} style={on ? { viewTransitionName: 'role-tile' } : undefined}
                  className={`flex size-9 items-center justify-center rounded-ctl text-white transition-opacity duration-200 ${on ? '' : 'opacity-45 group-hover:opacity-100'}`}>
              <x.icon className="size-[18px]" />
            </span>
            <span className={`text-micro font-semibold ${on ? 'text-fg-1' : 'text-fg-4 group-hover:text-fg-2'}`}>{x.short}</span>
          </button>
        )
      })}
    </div>
  )
  // open: the modes side by side in one row, the one you are in raised; a + adds another
  return (
    <div role="radiogroup" aria-label="Role" className="hidden gap-1 rounded-ctl bg-fill/60 p-1 md:flex">
      {joined.map((r) => {
        const x = ROLES[r], on = r === role
        return (
          <button key={r} role="radio" aria-checked={on} onClick={() => !on && setRole(r)} title={`${x.label} · ${x.hint}`}
                  className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-ctl px-1.5 py-1.5 text-small transition-colors ${on ? 'sel font-semibold' : 'font-medium text-fg-3 hover:text-fg-1'}`}>
            <span data-role-tile={r} style={on ? { viewTransitionName: 'role-tile' } : undefined} className={`flex size-5 shrink-0 items-center justify-center rounded-chip text-white ${on ? '' : 'opacity-60'}`}><x.icon className="size-3" /></span>
            <span className="truncate">{x.short}</span>
          </button>
        )
      })}
      {joined.length < ready(Object.keys(ROLES) as Role[]).length && (
        <button onClick={onJoin} title="Add a role" aria-label="Add a role" className="flex w-8 shrink-0 items-center justify-center rounded-ctl text-fg-4 transition-colors hover:bg-hover hover:text-fg-1"><Plus className="size-3.5" /></button>
      )}
    </div>
  )
}
