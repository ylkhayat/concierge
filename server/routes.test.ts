// Two routes with the same method and path: only the first ever answers, so the second is dead code that looks alive
// (a new "add to a GitHub project" route sat behind the Linear project link and sent it an empty project).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('no two routes share a method and a path', () => {
  const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
  const seen = new Map<string, number>(), twice: string[] = []
  for (const m of src.matchAll(/^app\.(get|post|put|patch|delete)\('([^']+)'/gm)) {
    const k = `${m[1].toUpperCase()} ${m[2]}`
    seen.set(k, (seen.get(k) ?? 0) + 1)
    if (seen.get(k) === 2) twice.push(k)
  }
  assert.deepEqual(twice, [])
})
