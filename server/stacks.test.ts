import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stacksFrom } from './github.ts'

const pull = (number: number, head: string, base: string, fork = false) => ({ number, title: `t${number}`, html_url: '', draft: false, user: { login: 'me' }, head: { ref: head, repo: { full_name: fork ? 'them/r' : 'o/r' } }, base: { ref: base } })
const lines = (m: ReturnType<typeof stacksFrom>) => Object.fromEntries([...m].map(([n, v]) => [n, { below: v.below, line: v.line.map((x) => x.number) }]))

test('a line of PRs: every one has the same line, and each knows the one it is built on', () => {
  const got = lines(stacksFrom('o/r', [pull(3, 'c', 'b'), pull(1, 'a', 'main'), pull(2, 'b', 'a')], 'main'))
  assert.deepEqual(got, { 1: { below: undefined, line: [1, 2, 3] }, 2: { below: 1, line: [1, 2, 3] }, 3: { below: 2, line: [1, 2, 3] } })
})

test('several PRs built on one: a tree. Each has its own line with the same bottom, and all agree on what is below', () => {
  // #1 with #2 → #5 on it, and #3 and #4 straight on #1 too
  const got = lines(stacksFrom('o/r', [pull(1, 'a', 'main'), pull(2, 'b', 'a'), pull(3, 'c', 'a'), pull(4, 'd', 'a'), pull(5, 'e', 'b')], 'main'))
  assert.deepEqual(got[1], { below: undefined, line: [1, 2, 5] }) // up along the oldest built on each
  assert.deepEqual(got[2], { below: 1, line: [1, 2, 5] })
  assert.deepEqual(got[5], { below: 2, line: [1, 2, 5] })
  assert.deepEqual(got[3], { below: 1, line: [1, 3] })
  assert.deepEqual(got[4], { below: 1, line: [1, 4] })
})

test("a fork's branch of the same name is not what a PR is built on; a PR on a branch with no open PR stands alone; a circle ends", () => {
  const got = lines(stacksFrom('o/r', [pull(1, 'a', 'main', true), pull(2, 'b', 'a'), pull(3, 'x', 'gone'), pull(4, 'p', 'q'), pull(5, 'q', 'p')], 'main'))
  assert.deepEqual(got[2], { below: undefined, line: [2] })
  assert.deepEqual(got[3], { below: undefined, line: [3] })
  assert.deepEqual(got[4].line.slice().sort(), [4, 5])
})
