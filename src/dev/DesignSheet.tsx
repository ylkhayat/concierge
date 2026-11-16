// The design system on one page (dev server: /?gallery=design): every token of src/design/tokens.css and every shape of
// src/design/recipes.css, drawn from the live CSS. Change a token, save, and see every swatch and part follow.
const Swatch = ({ name, cls, text }: { name: string; cls: string; text?: string }) => (
  <div className="flex items-center gap-2.5"><span className={`size-9 shrink-0 rounded-ctl ring-1 ring-line ${cls}`} /><span><span className="block font-mono text-meta text-fg-1">{name}</span>{text && <span className="block text-micro text-fg-3">{text}</span>}</span></div>
)
const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-3"><h2 className="label text-fg-4">{title}</h2><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{children}</div></section>
)
const STATUS = ['run', 'wait', 'ok', 'fail'] as const

export function DesignSheet() {
  return (
    <div className="mx-auto max-w-5xl space-y-10 px-6 py-10">
      <header><h1 className="text-display font-semibold text-fg-1">Design system</h1>
        <p className="mt-1 text-body text-fg-3">Tokens: <code className="font-mono">src/design/tokens.css</code> · shapes: <code className="font-mono">src/design/recipes.css</code>. Nothing else sets a colour, a corner or a size.</p></header>
      <Group title="Surfaces">
        <Swatch name="bg-bg-app" cls="bg-bg-app" text="the page" /><Swatch name="bg-surface-1" cls="bg-surface-1" text="cards" /><Swatch name="bg-surface-2" cls="bg-surface-2" text="raised panels" />
        <Swatch name="bg-fill" cls="bg-fill" text="quiet fills, tracks" /><Swatch name="bg-fill-strong" cls="bg-fill-strong" text="pressed, toggles" /><Swatch name="bg-hover" cls="bg-hover" text="under the pointer" /><Swatch name="bg-active" cls="bg-active" text="held down" />
      </Group>
      <Group title="Text and lines">
        {(['fg-1', 'fg-2', 'fg-3', 'fg-4'] as const).map((t, i) => <Swatch key={t} name={`text-${t}`} cls={{ 'fg-1': 'bg-fg-1', 'fg-2': 'bg-fg-2', 'fg-3': 'bg-fg-3', 'fg-4': 'bg-fg-4' }[t]} text={['titles, body', 'secondary', 'metadata', 'hints, disabled'][i]} />)}
        <Swatch name="ring-line" cls="bg-line" text="hairlines" /><Swatch name="ring-line-strong" cls="bg-line-strong" text="fields, popovers" />
      </Group>
      <Group title="Accent (follows the mode and the workspace)">
        <Swatch name="bg-accent" cls="bg-accent" /><Swatch name="bg-accent-hover" cls="bg-accent-hover" /><Swatch name="bg-accent-soft" cls="bg-accent-soft" /><Swatch name="text-accent-text" cls="bg-accent-text" />
      </Group>
      <section className="space-y-3"><h2 className="label text-fg-4">Status: one meaning each</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {STATUS.map((s) => { const c = { run: ['bg-run', 'bg-run/10', 'text-run-text', 'ring-run/30', 'working'], wait: ['bg-wait', 'bg-wait/10', 'text-wait-text', 'ring-wait/30', 'waits on you'], ok: ['bg-ok', 'bg-ok/10', 'text-ok-text', 'ring-ok/30', 'done, safe'], fail: ['bg-fail', 'bg-fail/10', 'text-fail-text', 'ring-fail/30', 'failed, blocked'] }[s]; return (
            <div key={s} className={`space-y-2 rounded-card p-3 ring-1 ${c[1]} ${c[3]}`}><span className="flex items-center gap-2"><span className={`size-2.5 rounded-full ${c[0]}`} /><span className={`text-small font-semibold ${c[2]}`}>{s}</span></span><p className={`text-meta ${c[2]}`}>{c[4]} · bg-{s}/10 · text-{s}-text</p></div>
          ) })}
        </div>
      </section>
      <section className="space-y-3"><h2 className="label text-fg-4">Type: seven sizes</h2>
        <div className="card space-y-1.5 p-4">
          <p className="text-display font-semibold">text-display · 24</p><p className="text-title font-semibold">text-title · 18</p><p className="text-reading">text-reading · 14.5, long prose</p>
          <p className="text-body">text-body · 13, the default</p><p className="text-small text-fg-2">text-small · 12.5, secondary</p><p className="text-meta text-fg-3">text-meta · 11.5, metadata</p><p className="text-micro text-fg-3">text-micro · 10.5, badges</p><p className="label text-fg-4">label · group headings</p>
        </div>
      </section>
      <section className="space-y-3"><h2 className="label text-fg-4">Corners and elevation</h2>
        <div className="flex flex-wrap items-end gap-4 text-meta text-fg-3">
          {[['rounded-ctl', 'controls'], ['rounded-card', 'cards'], ['rounded-panel', 'panels, sheets'], ['rounded-full', 'pills, dots']].map(([r, t]) => <div key={r} className="space-y-1.5"><div className={`h-14 w-24 bg-fill ring-1 ring-line ${r}`} /><p className="font-mono text-fg-1">{r}</p><p>{t}</p></div>)}
          {[['shadow-e1', 'cards'], ['shadow-e2', 'popovers'], ['shadow-e3', 'dialogs']].map(([r, t]) => <div key={r} className="space-y-1.5"><div className={`h-14 w-24 rounded-card bg-surface-1 ${r}`} /><p className="font-mono text-fg-1">{r}</p><p>{t}</p></div>)}
        </div>
      </section>
      <section className="space-y-3"><h2 className="label text-fg-4">Shapes (recipes.css)</h2>
        <div className="card flex flex-wrap items-center gap-3 p-4">
          <button className="btn-primary btn-sm">btn-primary btn-sm</button><button className="btn-primary">btn-primary</button><button className="btn-primary btn-lg">btn-primary btn-lg</button><button className="btn-primary" disabled>disabled</button>
          <button className="btn-quiet btn-sm">btn-quiet btn-sm</button><button className="btn-quiet">btn-quiet</button>
          <span className="sel rounded-ctl px-3 py-1.5 text-small">sel · the chosen one</span><span className="hov rounded-ctl px-3 py-1.5 text-small text-fg-2">hov · hover me</span>
        </div>
      </section>
    </div>
  )
}
