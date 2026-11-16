// The app against the made-up API: npx vite --config dev/preview/vite.config.mjs (port 5199)
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
export default defineConfig({ root: new URL('../..', import.meta.url).pathname, plugins: [react(), tailwindcss()], define: { __VERSION__: '"preview"' },
  server: { port: 5199, strictPort: true, proxy: { '/api': 'http://127.0.0.1:4799' } } })
