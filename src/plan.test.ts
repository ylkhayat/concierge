import assert from 'node:assert/strict'
import { test } from 'node:test'
import { reviewPlan } from './plan.ts'
import type { PrView } from '../server/index.ts'

const stack = [3, 4, 5].map((n) => ({ repo: 'o/app', number: n }))
const pr = (n: number, inStack = true) => ({ id: `o/app#${n}`, repo: 'o/app', number: n, stack: inStack ? stack : undefined }) as unknown as PrView
const prs = [pr(3), pr(4), pr(5), pr(9, false)]

test('a stack is reviewed bottom first whatever order it was picked in; other PRs on their own', () => {
  assert.deepEqual(reviewPlan(['o/app#9', 'o/app#5', 'o/app#3'], prs), [['o/app#9'], ['o/app#3', 'o/app#5']])
})
test('unknown picks are left out', () => {
  assert.deepEqual(reviewPlan(['o/app#4', 'o/app#77'], prs), [['o/app#4']])
})
