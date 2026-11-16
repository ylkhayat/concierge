import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Plan } from './planOps.ts'
import { coverage, obligations, resources } from './readiness.ts'

const plan = (brief: string, titles: string[] = []): Plan => ({ id: 'p', title: 't', brief, method: 'agile', messages: [], costUsd: 0, at: '', links: [],
  nodes: [{ id: 'g', kind: 'goal', title: 'G' }, ...titles.map((t, i) => ({ id: `t${i}`, kind: 'ticket' as const, title: t, parent: 'g', estimate: 3 }))] })
const eu = { regions: ['eu'], certifications: ['soc2'], data: ['personal', 'recordings'], reviews: ['security'] }

test('an EU, SOC 2 company recording calls owes a DPIA, consent, retention, change review and a security review', () => {
  const ids = obligations(eu, plan('Record customer calls in the meeting page and store the transcript for each user')).map((o) => o.id)
  for (const id of ['dpia', 'lawful-basis', 'retention', 'recording-consent', 'change-review', 'security-review', 'rollout', 'accessibility']) assert.ok(ids.includes(id), id)
  assert.ok(!ids.includes('pci-scope') && !ids.includes('phi'))
})

test('a company with no profile still owes a rollout and a test plan for user-facing work, and nothing legal', () => {
  const ids = obligations(undefined, plan('A new settings page', ['a', 'b', 'c', 'd'])).map((o) => o.id)
  assert.ok(ids.includes('rollout') && ids.includes('test-plan'))
  assert.ok(!ids.includes('dpia') && !ids.includes('change-review'))
})

test('a ticket covers an obligation by the planner\'s word or its title; resources compare scope with the team in the appetite', () => {
  const p = plan('Record calls for each user', ['Run the DPIA with legal', 'Ship it'])
  p.nodes[2].covers = ['retention']
  const cov = coverage(p, obligations(eu, p))
  assert.equal(cov.find((x) => x.ob.id === 'dpia')!.by?.id, 't0')
  assert.equal(cov.find((x) => x.ob.id === 'retention')!.by?.id, 't1')
  assert.equal(cov.find((x) => x.ob.id === 'lawful-basis')!.by, undefined)
  p.appetite = { weeks: 4, from: '' }
  const r = resources(p, { ...eu, team: [{ name: 'Ana', role: 'engineer', pace: 6 }, { name: 'Ben', role: 'engineer' }] }, 1, 5, 30, obligations(eu, p))
  assert.deepEqual([r.capacity, r.demand, r.missing], [44, 30, []]) // the security review is a company review
})

test('the people a plan counts: its project members, else its team, a shared person giving each team a share', () => {
  const company = { team: [{ name: 'Ana', role: 'engineer', pace: 6, teams: ['WA', 'AI'], linearId: 'u1' }, { name: 'Ben', role: 'engineer', pace: 4, teams: ['WA'] }, { name: 'Cy', role: 'designer', teams: ['DA'] }] }
  const p = plan('x'); p.appetite = { weeks: 2, from: '' }
  const onWA = resources(p, company, 1, 5, 10, [], 'WA')
  assert.deepEqual([onWA.weekly, onWA.capacity, onWA.people.map((x) => x.m.name)], [7, 14, ['Ana', 'Ben']]) // Ana gives half her 6
  p.members = [{ id: 'u1', name: 'Ana' }]
  assert.equal(resources(p, company, 1, 5, 10, [], 'WA').weekly, 6) // on the project: all of her week
})
