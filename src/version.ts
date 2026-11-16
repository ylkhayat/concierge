// The build this tab runs: "<commits>-<sha>" (vite.config.ts), shown as v<commits> so a newer one is plainly bigger.
declare const __VERSION__: string
export const VERSION = __VERSION__
export const label = (v: string) => (/^\d+-/.test(v) ? `v${v.split('-')[0]}` : v)
export const sha = (v: string) => v.split('-')[1]
