import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'node:child_process'

// "<commits>-<sha>": from bin/update in the image (no .git there), else from git; "dev" without either
const git = (args: string) => execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
const version = /^\d+-\w+$/.test(process.env.DECK_VERSION ?? '') ? process.env.DECK_VERSION! : (() => { try { return `${git('rev-list --count HEAD')}-${git('rev-parse --short HEAD')}` } catch { return 'dev' } })()

export default defineConfig({
  plugins: [react(), tailwindcss(), { name: 'version', transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'deck-version', content: version }, injectTo: 'head' }] }],
  define: { __VERSION__: JSON.stringify(version) },
  server: { proxy: { '/api': 'http://127.0.0.1:4747' } },
  build: { chunkSizeWarningLimit: 2000 }, // the Explain chunk (graph libraries) is lazy-loaded on purpose
})
