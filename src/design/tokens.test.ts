// The words on the page can be read: each text token against each surface it is written on, in both themes.
// The neutrals have almost no colour, so their luminance is OKLCH's lightness cubed (exact for a grey); that is close
// enough to hold a floor, and it needs no colour library. Change a token and this says whether it still reads.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')
const light = css.slice(css.indexOf(':root {'), css.indexOf(':root.dark {')), dark = css.slice(css.indexOf(':root.dark {'))
const num = (block: string, name: string) => Number(new RegExp(`--${name}:\\s*([\\d.]+)`).exec(block)?.[1])
/** A token's lightness: `oklch(0.53 …)`, or `oklch(calc(var(--d) + 0.035) …)` over the theme's base. */
const L = (block: string, name: string, base: number) => {
  const v = new RegExp(`--${name}:\\s*oklch\\(([^)]*\\)?[^)]*)\\)`).exec(block)?.[1] ?? ''
  const calc = /calc\(var\(--[ld]\)\s*([+-])\s*([\d.]+)/.exec(v)
  if (calc) return base + (calc[1] === '+' ? 1 : -1) * Number(calc[2])
  if (/^var\(--[ld]\)/.test(v)) return base
  return Number(/^([\d.]+)/.exec(v)?.[1])
}
const ratio = (a: number, b: number) => { const [hi, lo] = [a ** 3, b ** 3].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }

for (const [theme, block, base] of [['light', light, num(light, 'l')], ['dark', dark, num(dark, 'd')]] as const) {
  const surfaces = ['bg-app', 'surface-1', 'surface-2', 'fill'].map((s) => [s, L(block, s, base)] as const)
  // what is read (fg-1 to fg-3, a status in words) holds 4.5:1; a hint beside it (fg-4) holds 3:1
  for (const [token, floor] of [['fg-1', 4.5], ['fg-2', 4.5], ['fg-3', 4.5], ['fg-4', 3], ['st-run-text', 4.5], ['st-wait-text', 4.5], ['st-ok-text', 4.5], ['st-fail-text', 4.5]] as const) {
    test(`${theme}: ${token} reads on every surface (${floor}:1)`, () => {
      const t = L(block, token, base)
      assert.ok(Number.isFinite(t), `--${token} not found in the ${theme} theme`)
      for (const [s, l] of surfaces) assert.ok(ratio(t, l) >= floor, `--${token} on --${s}: ${ratio(t, l).toFixed(2)}:1, under ${floor}:1`)
    })
  }
}
