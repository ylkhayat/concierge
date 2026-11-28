// What moves after it is drawn: node dev/preview/shift.mjs <url> [role] [w] [h]. Loads the preview (start the mock with
// MOCK_MS=250 so answers take time, as a real server's do), runs SHIFT_STEPS (JS expressions, ";;" between them, each run in
// the page then waited SHIFT_WAIT ms), and print every layout shift the browser recorded after each, with what moved.
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const [url, role = 'developer', w = '1500', h = '900'] = process.argv.slice(2)
const chrome = spawn(process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${w},${h}`, '--remote-debugging-port=9334', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'shift-'))}`, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let tabs; for (let i = 0; i < 40 && !tabs; i++) { await sleep(250); tabs = await fetch('http://127.0.0.1:9334/json').then((r) => r.json()).catch(() => undefined) }
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0; const wait4 = new Map()
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && wait4.has(m.id)) { wait4.get(m.id)(m.result); wait4.delete(m.id) } })
const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait4.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Runtime.enable'); await send('Page.enable')
const rec = `
window.__shifts = []; window.__mark = 'load'
const say = (n) => { if (!n) return '?'; const e = n.nodeType === 1 ? n : n.parentElement; if (!e) return '?'; return e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '.' + String(e.className?.baseVal ?? e.className ?? '').split(/\\s+/).slice(0, 5).join('.') + ' "' + (e.textContent ?? '').trim().replace(/\\s+/g, ' ').slice(0, 46) + '"' }
// the browser's own measure ignores a move under 3px, so every element's place is also followed frame by frame: one that
// is there, and later somewhere else (by a pixel or more) with nothing having been pressed since, moved
window.__moves = []; let first = new WeakMap(), told = new WeakSet(), mark0 = ''
const frame = () => {
  if (window.__mark !== mark0) { mark0 = window.__mark; first = new WeakMap(); told = new WeakSet(); window.__since = performance.now() }
  // (the first 120ms after a press are the page being redrawn for it: what is there then is where things start)
  if (mark0 !== 'load' && performance.now() - window.__since > 120) for (const e of document.querySelectorAll('body *')) {
    if (e.closest('[data-noshift], svg, [aria-hidden=true]')) continue
    const r = e.getBoundingClientRect()
    if (r.width < 8 || r.height < 8 || r.bottom < 0 || r.top > innerHeight) continue
    if (!e.checkVisibility({ checkVisibilityCSS: true })) { first.delete(e); continue } // not shown: where it is doesn't matter yet
    const f = first.get(e)
    if (!f) { first.set(e, [r.x, r.y, r.width, r.height]); continue }
    if (told.has(e)) continue
    if (Math.abs(r.x - f[0]) >= 1 || Math.abs(r.y - f[1]) >= 1) {
      told.add(e)
      const pf = e.parentElement && first.get(e.parentElement), pr = e.parentElement?.getBoundingClientRect()
      // moved with its parent (by the same amount): the parent is the one to name
      if (pf && pr && Math.abs((pr.x - pf[0]) - (r.x - f[0])) < 1 && Math.abs((pr.y - pf[1]) - (r.y - f[1])) < 1) continue
      window.__moves.push({ mark: mark0, ms: Math.round(performance.now() - window.__since), el: say(e), from: f.map(Math.round).join(','), to: [r.x, r.y, r.width, r.height].map(Math.round).join(',') })
    }
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__shifts.push({ mark: window.__mark, v: +e.value.toFixed(4), src: e.sources.map((s) => ({ el: say(s.node), from: [s.previousRect.x, s.previousRect.y, s.previousRect.width, s.previousRect.height].map(Math.round).join(','), to: [s.currentRect.x, s.currentRect.y, s.currentRect.width, s.currentRect.height].map(Math.round).join(',') })) }) }).observe({ type: 'layout-shift', buffered: true })
`
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('role', ${JSON.stringify(role)}); for (const [k, v] of Object.entries(${process.env.SHOT_LS ?? '{}'})) localStorage.setItem(k, v) } catch {}\n${rec}` })
await send('Page.navigate', { url })
await sleep(Number(process.env.SHIFT_LOAD) || 5000)
for (const [i, step] of (process.env.SHIFT_STEPS ?? '').split(';;').filter(Boolean).entries()) {
  const r = await send('Runtime.evaluate', { expression: `window.__mark = ${JSON.stringify(`step ${i + 1}`)}; (() => { ${step} })()`, returnByValue: true })
  console.log(`step ${i + 1}:`, JSON.stringify(r.result?.value ?? r.exceptionDetails?.text ?? null))
  await sleep(Number(process.env.SHIFT_WAIT) || 2500)
}
const r = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__shifts)', returnByValue: true })
const all = JSON.parse(r.result.value)
for (const m of [...new Set(all.map((s) => s.mark))]) {
  if (m === 'load' && !process.env.SHIFT_LOAD_TOO) continue
  const mine = all.filter((s) => s.mark === m)
  console.log(`\n== ${m}: ${mine.length} shifts, total ${mine.reduce((n, s) => n + s.v, 0).toFixed(4)}`)
  for (const s of mine) for (const x of s.src) console.log(`  ${s.v}  ${x.from} -> ${x.to}  ${x.el}`)
}
if (!all.some((s) => s.mark !== 'load')) console.log('\nno shifts after the steps')
const mv = JSON.parse((await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__moves)', returnByValue: true })).result.value)
for (const m of [...new Set(mv.map((s) => s.mark))]) { console.log(`\n-- ${m}: ${mv.filter((s) => s.mark === m).length} elements moved`); for (const x of mv.filter((s) => s.mark === m).slice(0, Number(process.env.SHIFT_MAX) || 8)) console.log(`  +${x.ms}ms  ${x.from} -> ${x.to}  ${x.el}`) }
if (!mv.length) console.log('nothing moved by a pixel')
if (process.env.SHIFT_SHOT) { const { writeFileSync } = await import('node:fs'); const shot = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(process.env.SHIFT_SHOT, Buffer.from(shot.data, 'base64')) }
chrome.kill(); process.exit(0)
