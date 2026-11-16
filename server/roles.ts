// Roles: the hats one person wears (developer, product, design), each a setup of its own. You join the ones you need;
// each keeps its workspaces and its slots (the skill or command it runs to review, revise, execute and plan), and
// owns its skills. A slot a role doesn't set is the developer's (your base setup, Settings → Workflows), so a skill can
// be shared as-is while Execute differs per role. A role can use any skill, but changes (improve, remove) only its own
// or shared ones.
// The role a request was made in comes with it (the page's x-concierge-role header): a run you start remembers it;
// a run nothing started (an automatic review) is the developer's.
import { skillFor } from './method.ts'
import { AsyncLocalStorage } from 'node:async_hooks'
import { config } from './config.ts'
import { save, state } from './store.ts'

export type Role = 'developer' | 'product' | 'design'
export const ROLE_IDS: Role[] = ['developer', 'product', 'design']
export type Slot = 'review' | 'revise' | 'exec' | 'plan'
export type Owner = Role | 'shared'
export type Setup = { rail?: string[]; slots?: Partial<Record<Slot, string>> }
export type Roles = { joined: Role[]; setups: Partial<Record<Role, Setup>>; skills: Record<string, Owner> }

export const roles = (): Roles => (state.roles ??= { joined: ['developer'], setups: {}, skills: {} })
const asRole = new AsyncLocalStorage<Role | undefined>()
export const withRole = <T,>(header: string | undefined, f: () => T) => asRole.run(ROLE_IDS.includes(header as Role) ? header as Role : undefined, f)
/** The role of the request in progress, else the first you joined (what you signed up as). */
export const currentRole = (): Role => asRole.getStore() ?? roles().joined[0] ?? 'developer'

const BASE: Record<Slot, () => string> = {
  review: () => config.agent.review.command, revise: () => config.agent.revise.command, exec: () => config.exec.command, plan: () => skillFor('plan'),
}
/** What a role runs for a slot: its own, else the developer's. */
export const slot = (s: Slot, role: Role = currentRole()) => (role !== 'developer' && roles().setups[role]?.slots?.[s]) || BASE[s]()
export const baseSlots = () => Object.fromEntries(Object.entries(BASE).map(([k, f]) => [k, f()])) as Record<Slot, string>

// the planning skill belongs to product; any other skill, to the role you signed up as, until you say otherwise
/** Who a skill belongs to; a skill a role's slot names is that role's. */
export function ownerOf(name: string): Owner {
  const r = roles()
  if (r.skills[name]) return r.skills[name]
  const used = ROLE_IDS.filter((x) => x !== 'developer' && Object.values(r.setups[x]?.slots ?? {}).some((c) => c && new RegExp(`(^|[/\\s:])${name}\\b`).test(c)))
  return used.length === 1 ? used[0] : name === skillFor('plan') ? 'product' : r.joined[0] ?? 'developer'
}
export const canChange = (name: string, role: Role = currentRole()) => { const o = ownerOf(name); return o === 'shared' || o === role }
export function mustChange(name: string) {
  const o = ownerOf(name), role = currentRole()
  if (o !== 'shared' && o !== role) throw new Error(`${name} belongs to your ${o} setup: switch to ${o} to change it, or share it with every role there`)
}

export function setRoles(v: { joined?: Role[]; role?: Role; setup?: Setup }) {
  const r = roles()
  if (v.joined) {
    const j = ROLE_IDS.filter((x) => v.joined!.includes(x))
    if (!j.length) throw new Error('Keep at least one role')
    r.joined = [...r.joined.filter((x) => j.includes(x)), ...j.filter((x) => !r.joined.includes(x))] // what you signed up as stays first
  }
  if (v.role && v.setup) {
    const s = (r.setups[v.role] ??= {})
    if (v.setup.rail) s.rail = v.setup.rail.filter((x) => typeof x === 'string').slice(0, 12)
    if (v.setup.slots) {
      if (v.role === 'developer') throw new Error('The developer\'s slots are your base setup: Settings → Workflows')
      const exec = v.setup.slots.exec
      if (exec && !exec.includes('{ids}')) throw new Error('The execute command must include {ids}')
      s.slots = Object.fromEntries(Object.entries({ ...s.slots, ...v.setup.slots }).filter(([, c]) => typeof c === 'string' && c.trim()).map(([k, c]) => [k, c!.trim().slice(0, 200)]))
    }
  }
  save()
  return r
}
/** Share a skill with every role, or give it to one: only the role it belongs to (or anyone, when shared) can. */
export function setOwner(name: string, owner: Owner) {
  mustChange(name)
  roles().skills[name] = owner; save()
}
