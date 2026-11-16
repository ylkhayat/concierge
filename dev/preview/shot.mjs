// A screenshot of the preview in headless Chrome: node dev/preview/shot.mjs <url> <out.png> [wait ms] [role] [width] [height] [hover x,y]; SHOT_CLICK=x,y clicks there and prints the API calls it caused
// Sets the role first (SHOT_LS / SHOT_SS: more localStorage / sessionStorage, as JSON); prints the page's errors. CHROME: the
// browser (default: Chrome on a Mac).
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const [url, out, wait = '8000', role = 'developer', w = '1600', h = '960', hover] = process.argv.slice(2)
const chrome = spawn(process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${w},${h}`, '--remote-debugging-port=9333', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'rd-shot-'))}`, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let tabs; for (let i = 0; i < 40 && !tabs; i++) { await sleep(250); tabs = await fetch('http://127.0.0.1:9333/json').then((r) => r.json()).catch(() => undefined) }
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0; const wait4 = new Map(), logs = []
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && wait4.has(m.id)) { wait4.get(m.id)(m.result); wait4.delete(m.id) } else if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + m.params.exceptionDetails.exception?.description?.slice(0, 300)) })
const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait4.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Runtime.enable'); await send('Page.enable')
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('role', ${JSON.stringify(role)}); for (const [k, v] of Object.entries(${process.env.SHOT_LS ?? '{}'})) localStorage.setItem(k, v); for (const [k, v] of Object.entries(${process.env.SHOT_SS ?? '{}'})) sessionStorage.setItem(k, v) } catch {}` })
await send('Page.navigate', { url })
await sleep(Number(wait))
if (hover) { const [x, y] = hover.split(',').map(Number); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await sleep(900) }
// SHOT_DRAG="x1,y1,x2,y2[;x1,y1,x2,y2…]": press, move in steps, release (one drag per group), then wait for the page
if (process.env.SHOT_DRAG) for (const g of process.env.SHOT_DRAG.split(';')) {
  const [a, b, c, d] = g.split(',').map(Number)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a, y: b }); await sleep(150)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a, y: b, button: 'left', clickCount: 1, buttons: 1 })
  for (let i = 1; i <= 10; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a + ((c - a) * i) / 10, y: b + ((d - b) * i) / 10, button: 'left', buttons: 1 }); await sleep(30) }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c, y: d, button: 'left', clickCount: 1 }); await sleep(900)
}
// SHOT_CLICK="x,y[;x,y…]": click there, one after another (after the hover), then print the API calls the page made because of it
if (process.env.SHOT_CLICK) for (const one of process.env.SHOT_CLICK.split(';')) {
  const [x, y] = one.split(',').map(Number)
  await send('Runtime.evaluate', { expression: `window.__calls = []; if (!window.__wrapped) { window.__wrapped = true; const f = window.fetch; window.fetch = (u, o) => { window.__calls.push((o?.method ?? 'GET') + ' ' + u + ' ' + (o?.body ?? '').slice(0, 80)); return f(u, o) } }` })
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await sleep(400)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); await sleep(1800)
  const r = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__calls)', returnByValue: true }); console.log('calls after click:', r.result.value)
}
// SHOT_PRESS="Label[;Label…]": press the button with that text (the last one on the page that has it), one after another
if (process.env.SHOT_PRESS) for (const label of process.env.SHOT_PRESS.split(';')) {
  const r = await send('Runtime.evaluate', { expression: `(() => { const b = [...document.querySelectorAll('button, label')].filter((x) => x.textContent.trim().startsWith(${JSON.stringify(label)}) && !x.disabled).at(-1); if (!b) return 'no button: ' + ${JSON.stringify(label)}; b.scrollIntoView({ block: 'center' }); b.click(); return 'pressed ' + ${JSON.stringify(label)} })()`, returnByValue: true })
  console.log(r.result.value); await sleep(2500)
}
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(out, Buffer.from(shot.data, 'base64'))
console.log(logs.slice(0, 8).join('\n') || 'no errors')
chrome.kill(); process.exit(0)
