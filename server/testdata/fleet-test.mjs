// A fleet for replica.test.ts: this machine is DECK_NAME; the lease holder is HOLDER, or what HOLDER_FILE says (a test
// moves the lease by rewriting it).
import { readFileSync } from 'node:fs'
const me = process.env.DECK_NAME
const holder = () => { try { return process.env.HOLDER_FILE ? readFileSync(process.env.HOLDER_FILE, 'utf8').trim() : process.env.HOLDER } catch { return process.env.HOLDER } }
export default { machine: me, elsewhere: () => { const h = holder(); return h && h !== me ? h : undefined }, mayWrite: () => holder() === me }
