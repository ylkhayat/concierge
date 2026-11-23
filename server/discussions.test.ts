import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withSteps } from './discussions.ts'

const reply = `I like it. One timeline would have shown the CallWatcherWin32 flood next to the audio events.

- Rate-limit and level-filter at the bridge.
- Keep a small native fallback file for crashes.
- Land 2126 as the interim fix, and do this in a new ticket.

Before removing the Sentry project: does it receive native crash reports? I'd keep it until we know.`

test("the steps an answer recommends become actions, the ones it already offers aren't doubled", () => {
  const had = [{ kind: 'ask-author' as const, label: 'Ask what the audio Sentry project holds', text: 'What does the audio Sentry project hold?' },
    { kind: 'steer' as const, label: 'Keep a fallback', text: 'Keep a small native fallback file for crashes.' }]
  const out = withSteps(reply, had)
  assert.deepEqual(out.slice(2).map((a) => [a.kind, a.text]), [
    ['steer', 'Rate-limit and level-filter at the bridge.'],
    ['steer', 'Land 2126 as the interim fix, and do this in a new ticket.'],
  ])
  assert.equal(withSteps('No bullets here.', []).length, 0)
  assert.equal(withSteps('- Should we keep it?', [])[0].kind, 'ask-author')
})
