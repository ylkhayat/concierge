// Loaded before every test file (npm test: node --import): each test process gets its own empty state folder, so
// nothing a test opens or saves (the state database, logs) can reach the real one in ~/.local/state.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.XDG_STATE_HOME ??= mkdtempSync(join(tmpdir(), 'rd-test-'))
