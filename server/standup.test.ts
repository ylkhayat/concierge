import { test } from 'node:test'
import assert from 'node:assert/strict'
import { asHtml, asText, forTeams, linkWritten, standupDay, startOf, workdayBefore, lastWorkday, standup } from './standup.ts'

test('a ticket with one thing done says that thing', () => {
  const prs = { 'o/r#1': pr(1, 'feat(x): WA-1 hold the number', { createdAt: at }), 'o/r#2': pr(2, 'fix(x): AI-2 a fix', { closed: true, updatedAt: at, reviewDecision: 'APPROVED' }), 'o/r#3': pr(3, 'docs: AI-3 an ADR', { mine: false }) }
  const runs = [{ at, entity: 'job', id: 'o/r#3', run: 'a', kind: 'review', to: 'done', cause: 'result' }] as any
  const s = standup({ since, runs, prs, tickets: [], execs: {} })
  assert.deepEqual(s.did.map((d) => `${d.lead} ${d.id}`), ['Opened a pull request for WA-1', 'Merged AI-2', 'Reviewed AI-3'])
})

test('the last working day skips the weekend', () => {
  assert.equal(lastWorkday(new Date(2026, 9, 26, 9)).getDay(), 5) // Monday → Friday
  assert.equal(lastWorkday(new Date(2026, 9, 23, 9)).getDate(), 22) // Friday → Thursday
})

const pr = (n: number, title: string, extra = {}) => ({ id: `o/r#${n}`, repo: 'o/r', number: n, title, url: `u${n}`, mine: true, closed: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', ...extra }) as any
const since = new Date('2026-10-22T00:00:00Z'), at = '2026-10-22T10:00:00Z'

test('tells it per Linear ticket, in plain sentences, leaving PRs without a ticket out', () => {
  const prs = {
    'o/r#1': pr(1, 'feat(x): AI-9 build the thing', { createdAt: at }),
    'o/r#2': pr(2, 'feat(x): AI-9 wire the thing', { createdAt: at, unresolved: 2, reviewDecision: 'APPROVED', updatedAt: at }),
    'o/r#3': pr(3, 'ci: retry apt-get update', { createdAt: at }), // no ticket: not mentioned
    'o/r#4': pr(4, 'docs(adr): AI-7 propose ADR-0031', { mine: false, requested: true }),
    'o/r#5': pr(5, 'fix(x): DA-3 stop the leak', { mine: false, requested: true }),
  }
  const runs = [
    { at, entity: 'job', id: 'o/r#2', run: 'a', kind: 'revise', to: 'done', cause: 'result' },
    { at, entity: 'job', id: 'o/r#2', run: 'b', kind: 'reply', to: 'done', cause: 'result' }, // the revise already covers it
    { at, entity: 'exec', id: 'AI-9', run: 'x', to: 'done', cause: 'result' },
  ] as any
  const tickets = [{ id: 'AI-9', title: 'Give the agent its state', url: 'https://linear.app/acme/issue/AI-9/give', bucket: 'tend', prs: [] }, { id: 'AI-5', title: 'Next thing', url: 'https://linear.app/acme/issue/AI-5', bucket: 'stalled', prs: [] }, { id: 'AI-6', title: 'Other', url: 'https://linear.app/acme/issue/AI-6', bucket: 'todo', prs: [] }] as any
  const s = standup({ since, runs, prs, tickets, execs: { x: { ids: ['AI-9'], outcomes: { 'AI-9': { outcome: 'shipped' } } } as any } })
  assert.deepEqual(s.text.split('\n'), [
    'What I did:',
    '- Progress on [AI-9](https://linear.app/acme/issue/AI-9/give)', // shipped, opened, feedback, approved: several things
    '',
    'Blockers:',
    '- None',
    '',
    'What I will do:',
    '- Work through the review comments on [AI-9](https://linear.app/acme/issue/AI-9/give) (2 open)',
    '- Investigate closing of [AI-5](https://linear.app/acme/issue/AI-5)', // stalled; AI-6 is only Todo, which stays out
    // a ticket not in my list still gets a link made from the workspace address
    '- Review [AI-7](https://linear.app/acme/issue/AI-7) and [DA-3](https://linear.app/acme/issue/DA-3)',
  ])
  assert.match(asHtml(s.did, s.next), /<li>Review <a href="https:\/\/linear.app\/acme\/issue\/AI-7">AI-7<\/a> and <a href="https:\/\/linear.app\/acme\/issue\/DA-3">DA-3<\/a><\/li>/)
  // a set of teams keeps only their tickets
  assert.deepEqual(forTeams(s.next, ['DA']).map((x) => x.id), ['DA-3'])
  assert.deepEqual(forTeams(s.next, ['AI', 'DA']).length, 4)
  assert.match(asText(forTeams(s.did, ['WA']), []), /Nothing on my tickets/)
})

test('on a weekend the standup to prepare is Monday\'s, counted from Friday', () => {
  const tz = 'Europe/Berlin'
  assert.equal(standupDay(new Date('2026-10-24T10:00:00Z'), tz), '2026-10-26') // Saturday → Monday
  assert.equal(standupDay(new Date('2026-10-25T10:00:00Z'), tz), '2026-10-26') // Sunday → Monday
  assert.equal(standupDay(new Date('2026-10-23T05:30:00Z'), tz), '2026-10-23') // a weekday: that day
  assert.equal(standupDay(new Date('2026-10-23T22:30:00Z'), tz), '2026-10-26') // Friday 23:30 UTC is Saturday in Berlin
  assert.equal(workdayBefore('2026-10-26'), '2026-10-23') // Monday counts from Friday
  assert.equal(workdayBefore('2026-10-28'), '2026-10-27')
  // midnight in Berlin, either side of the clocks going back on 25 October
  assert.equal(startOf('2026-10-23', tz).toISOString(), '2026-10-22T22:00:00.000Z')
  assert.equal(startOf('2026-10-26', tz).toISOString(), '2026-10-25T23:00:00.000Z')
})

test('a written standup gets its ticket ids linked, as Markdown and as lists', () => {
  const { md, html } = linkWritten('What I did:\n- Merged AI-1, the fix\n\nWhat I will do:\n- Review DA-2', { 'AI-1': 'https://l/AI-1', 'DA-2': 'https://l/DA-2' })
  assert.equal(md, 'What I did:\n- Merged [AI-1](https://l/AI-1), the fix\n\nWhat I will do:\n- Review [DA-2](https://l/DA-2)')
  assert.equal(html, '<p>What I did:</p><ul><li>Merged <a href="https://l/AI-1">AI-1</a>, the fix</li></ul><p>What I will do:</p><ul><li>Review <a href="https://l/DA-2">DA-2</a></li></ul>')
})

test('product work comes first, side quests apart; one kind alone needs no headings', () => {
  const did = [{ id: 'AC-1', title: 'Fix a crash', lead: 'Merged' }, { id: 'AC-2', title: 'Agent state', lead: 'Progress on', project: 'Checkout redesign' }]
  const next = [{ kind: 'continue' as const, id: 'AC-2', title: 'Agent state', project: 'Checkout redesign' }]
  assert.deepEqual(asText(did, next).split('\n'), ['What I did:', 'Product:', '- Progress on AC-2', 'Side quests:', '- Merged AC-1', '', 'Blockers:', '- None', '', 'What I will do:', '- Continue the remaining work on AC-2'])
  assert.match(asHtml(did, next), /<p><i>Product<\/i><\/p><ul><li>Progress on AC-2<\/li><\/ul><p><i>Side quests<\/i><\/p>/)
})

test('blockers come from where the tickets stand, an answer owed first; your own lines join each part', () => {
  const tickets = [
    { id: 'AI-1', title: 'Review me', bucket: 'shipped', prs: [], pr: { number: 11 } },
    { id: 'AI-2', title: 'Red', bucket: 'in-progress', prs: [], pr: { number: 12, ci: 'failure' } },
    { id: 'AI-3', title: 'Asked', bucket: 'needs-you', prs: [] },
    { id: 'AI-4', title: 'Merged already', bucket: 'shipped', prs: [], pr: { number: 14, merged: true } },
    { id: 'AI-5', title: 'Done', bucket: 'shipped', prs: [], pr: { number: 15 }, closed: true },
  ] as any
  const s = standup({ since: new Date('2026-01-01'), runs: [], prs: {}, tickets, execs: {} })
  assert.deepEqual(s.blockers.map((b) => [b.id, b.kind]), [['AI-3', 'answer'], ['AI-2', 'ci'], ['AI-1', 'review']])
  const text = asText([], [], s.blockers, { blockers: ['Waiting on design for the empty state'], next: ['Pair with Sam on the release'] }).split('\n')
  assert.ok(text.includes('- CI is red on #12 (AI-2)'))
  assert.ok(text.includes('- Waiting on design for the empty state'))
  assert.ok(text.includes('- Pair with Sam on the release'))
  assert.ok(!text.includes('- Nothing waiting on me')) // your line fills the part
})
