// Readiness: what a plan must cover for the company it ships in. The company profile (Settings → Company: where its
// customers are, what it is certified for, what data it handles, which reviews it requires, its team) and the plan's
// own words decide the obligations: a DPIA when an EU company starts new personal-data processing, change review under
// SOC 2, a consent notice for recordings, a rollout and a way back for anything users see. Each belongs to an area;
// a ticket covers one when the planner says so (`covers`) or its title says it. Pure: the page and the planner share it.
import type { Plan, PlanNode } from './planOps.ts'

export type Company = {
  regions?: string[]; certifications?: string[]; data?: string[]; reviews?: string[]
  // pace: points a week (unset: the plan's); teams: the Linear teams they work in (a person can be on several);
  // linearId: who they are in Linear (to match a project's members)
  team?: Member[]
  name?: string // the company's name (from Linear)
}
export type Member = { name: string; role: string; pace?: number; teams?: string[]; linearId?: string }
export const REGIONS: [string, string][] = [['eu', 'EU · GDPR'], ['uk', 'UK · UK GDPR'], ['us', 'US · CCPA and state laws'], ['ch', 'Switzerland · nFADP'], ['ca', 'Canada · PIPEDA'], ['br', 'Brazil · LGPD']]
export const CERTIFICATIONS: [string, string][] = [['soc2', 'SOC 2'], ['iso27001', 'ISO 27001'], ['hipaa', 'HIPAA'], ['pci', 'PCI DSS']]
export const DATA: [string, string][] = [['personal', 'Personal data'], ['recordings', 'Recordings and transcripts'], ['health', 'Health data'], ['payments', 'Payments'], ['children', 'Children’s data'], ['credentials', 'Credentials and tokens']]
export const REVIEWS: [string, string][] = [['security', 'Security review'], ['legal', 'Legal review'], ['dpo', 'Data protection officer'], ['design', 'Design review'], ['qa', 'QA sign-off']]
export const ROLES: [string, string][] = [['engineer', 'Engineer'], ['designer', 'Designer'], ['qa', 'QA'], ['pm', 'Product'], ['data', 'Data'], ['security', 'Security']]

export type Area = 'compliance' | 'security' | 'operations' | 'quality'
export const AREAS: { id: Area; label: string; hue: number }[] = [
  { id: 'compliance', label: 'Compliance', hue: 150 }, { id: 'security', label: 'Security', hue: 25 },
  { id: 'operations', label: 'Operations', hue: 250 }, { id: 'quality', label: 'Quality', hue: 300 },
]
export type Obligation = { id: string; area: Area; title: string; why: string; match: RegExp; role?: string }

/** The plan's words: its brief, vision and every item's title and description. */
const wordsOf = (p: Plan) => [p.brief, p.project?.vision ?? '', ...p.nodes.map((n) => `${n.title} ${n.description ?? ''}`)].join('\n').toLowerCase()

/** What this plan must cover, for this company. */
export function obligations(company: Company | undefined, p: Plan): Obligation[] {
  const c = company ?? {}, w = wordsOf(p)
  const has = (k: keyof Company, v: string) => ((c[k] as string[] | undefined) ?? []).includes(v)
  const says = (re: RegExp) => re.test(w)
  const privacy = ['eu', 'uk', 'ch', 'br'].some((r) => has('regions', r)) || has('regions', 'us') || has('regions', 'ca')
  const personal = has('data', 'personal') && says(/\b(user|customer|member|people|person|email|name|profile|account|contact|track|analytic|log|store|collect|record)/)
  const recordings = has('data', 'recordings') && says(/\b(record|recording|audio|video|call|meeting|transcri)/)
  const integration = says(/\b(integrat|third[- ]party|vendor|provider|webhook|oauth|partner|external api|sync with)/)
  const access = says(/\b(auth|login|sign[- ]in|permission|role|admin|token|api key|access|share|invite)/)
  const ui = says(/\b(page|screen|ui|button|form|dialog|modal|onboarding|settings|dashboard|email)/)
  const o: Obligation[] = []
  const add = (x: Omit<Obligation, 'match'> & { match: RegExp }) => { if (!o.some((y) => y.id === x.id)) o.push(x) }
  if (privacy && personal) {
    if (['eu', 'uk', 'ch', 'br'].some((r) => has('regions', r))) add({ id: 'dpia', area: 'compliance', title: 'Data protection impact assessment', why: 'New processing of personal data under GDPR-style law needs a DPIA before it ships', match: /\b(dpia|impact assessment|privacy assessment)/, role: has('reviews', 'dpo') ? 'dpo' : undefined })
    add({ id: 'lawful-basis', area: 'compliance', title: 'Lawful basis and privacy notice', why: 'Say why the data is processed, and tell the people it is about', match: /\b(lawful basis|privacy notice|privacy policy|consent)/ })
    add({ id: 'retention', area: 'compliance', title: 'Retention and deletion', why: 'How long the data is kept, and how it is deleted on request', match: /\b(retention|delet|erasure|purge|right to be forgotten)/ })
  }
  if (recordings) add({ id: 'recording-consent', area: 'compliance', title: 'Recording consent and notice', why: 'People must be told, and in many places agree, before they are recorded', match: /\b(consent|notice|announce)/ })
  if (has('data', 'children') && personal) add({ id: 'children', area: 'compliance', title: 'Children’s data safeguards', why: 'Age checks and parental consent where children may use it', match: /\b(age|parental|child)/ })
  if (has('certifications', 'hipaa') && has('data', 'health')) add({ id: 'phi', area: 'compliance', title: 'PHI handling and BAAs', why: 'Health data needs HIPAA safeguards, and a BAA with every vendor that touches it', match: /\b(phi|hipaa|baa)/ })
  if (has('certifications', 'pci') && (has('data', 'payments') || says(/\b(payment|card|checkout|billing)/))) add({ id: 'pci-scope', area: 'compliance', title: 'PCI scope check', why: 'Card data must stay out of your systems, or inside PCI scope', match: /\b(pci|card data|tokeni[sz])/ })
  if (has('certifications', 'soc2')) {
    add({ id: 'change-review', area: 'compliance', title: 'Change review and approval', why: 'SOC 2: every change reviewed and approved, with the trail kept', match: /\b(change review|approval|change management)/ })
    if (access) add({ id: 'audit-log', area: 'security', title: 'Audit log of access and changes', why: 'SOC 2: who did what, when, kept and reviewable', match: /\b(audit|activity log|history)/ })
  }
  if (has('certifications', 'iso27001')) add({ id: 'risk-entry', area: 'compliance', title: 'Risk register entry', why: 'ISO 27001: the new risk assessed and recorded', match: /\b(risk register|risk assessment)/ })
  if (integration) add({ id: 'vendor-review', area: 'security', title: 'Vendor and integration review', why: 'A new third party sees your data: review it before it does', match: /\b(vendor review|vendor assessment|third[- ]party review|dpa)/, role: 'security' })
  if (access || has('data', 'credentials') || has('reviews', 'security')) add({ id: 'security-review', area: 'security', title: 'Security review', why: access ? 'It changes who can see or do what' : 'The company reviews every change for security', match: /\b(security review|threat model|pen ?test|security assessment)/, role: 'security' })
  if (has('data', 'credentials') && access) add({ id: 'secrets', area: 'security', title: 'Secrets and tokens handled safely', why: 'Stored encrypted, scoped, rotated, never logged', match: /\b(secret|token|encrypt|rotat)/ })
  // operations and quality: anything users will see
  if (ui || p.nodes.length > 3) {
    add({ id: 'rollout', area: 'operations', title: 'Rollout plan and a way back', why: 'A flag or a beta first, and a way to undo it', match: /\b(rollout|roll out|feature flag|beta|rollback|canary|launch)/ })
    add({ id: 'monitoring', area: 'operations', title: 'Monitoring and alerts', why: 'Know it works in production, and hear when it doesn’t', match: /\b(monitor|alert|metric|dashboard|observab|sentry)/ })
    add({ id: 'support', area: 'operations', title: 'Support and docs', why: 'Support can answer, and users can find how it works', match: /\b(support|docs?|help (?:center|article)|faq|changelog|release note)/ })
    add({ id: 'test-plan', area: 'quality', title: 'Test plan', why: 'What is tested, by whom, before it ships', match: /\b(test|qa|e2e|regression)/, role: has('reviews', 'qa') ? 'qa' : undefined })
  }
  if (ui) add({ id: 'accessibility', area: 'quality', title: 'Accessibility check', why: 'Keyboard, screen readers and contrast, for everyone who uses it', match: /\b(accessib|a11y|wcag|screen reader)/ })
  if (has('reviews', 'legal') && ui) add({ id: 'legal-copy', area: 'compliance', title: 'Legal review of what users read', why: 'The company reviews customer-facing terms and notices', match: /\b(legal|terms|wording)/ })
  return o
}

/** Each obligation, and the ticket that covers it (the planner's `covers`, else a title that says it). */
export function coverage(p: Plan, obs: Obligation[]): { ob: Obligation; by?: PlanNode }[] {
  const live = p.nodes.filter((n) => n.kind !== 'goal' && n.parent !== 'later' && n.state?.type !== 'canceled')
  return obs.map((ob) => ({ ob, by: live.find((n) => n.covers?.includes(ob.id)) ?? live.find((n) => ob.match.test(n.title.toLowerCase())) }))
}

/**
 * The people a plan can count on: its project's members when it has a project, else the people on its Linear team,
 * else everyone in the profile. Someone on several teams gives each a share of their week (a plan's project members
 * give it all of theirs: they are on it).
 */
export function peopleFor(p: Plan, company: Company | undefined, teamKey?: string): { m: Member; share: number }[] {
  const team = company?.team ?? []
  const members = p.members ?? []
  if (members.length) {
    const on = team.filter((m) => members.some((x) => x.id === m.linearId || x.name === m.name))
    if (on.length) return on.map((m) => ({ m, share: 1 }))
  }
  if (teamKey) {
    const on = team.filter((m) => m.teams?.includes(teamKey))
    if (on.length) return on.map((m) => ({ m, share: 1 / Math.max(1, m.teams!.length) }))
  }
  return team.map((m) => ({ m, share: 1 / Math.max(1, m.teams?.length ?? 1) }))
}

/** Resources: the points in scope against what its people finish inside the appetite, and roles the work needs that they lack. */
export function resources(p: Plan, company: Company | undefined, people: number, pace: number, scopePoints: number, obs: Obligation[], teamKey?: string) {
  const team = peopleFor(p, company, teamKey)
  const weekly = Math.round((team.length ? team.reduce((a, { m, share }) => a + (m.pace ?? pace) * share, 0) : people * pace) * 10) / 10
  const capacity = p.appetite ? Math.round(p.appetite.weeks * weekly) : undefined
  const missing = [...new Set(obs.map((o) => o.role).filter((r): r is string => !!r))].filter((r) => !team.some(({ m }) => m.role === r) && !(company?.reviews ?? []).includes(r))
  return { capacity, demand: Math.round(scopePoints), weekly, missing, people: team }
}
