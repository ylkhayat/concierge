// A flow (Explain's Mermaid diagram) said as plain steps, for the Understanding board: no code to read.

/**
 * A flow written as a Mermaid diagram, said as its steps in order: a flowchart's boxes as they first appear
 * ("A[Call prepared] --> B[Build session]"), a sequence's messages ("Phone->>Server: asks for a voice"). Code-looking
 * names read as words ("build_session_start" → "build session start"). Nothing recognised: the text as it is.
 */
export function stepsOf(m?: string): string[] {
  if (!m) return []
  const tidy = (x: string) => x.replace(/["'`]/g, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (/^\s*sequenceDiagram/.test(m)) return [...m.matchAll(/^\s*[\w ]+-{1,2}>>?[+-]?\s*[\w ]+\s*:\s*(.+)$/gm)].map((x) => tidy(x[1])).filter(Boolean).slice(0, 8)
  const seen = new Set<string>(), out: string[] = []
  for (const x of m.matchAll(/\b([A-Za-z]\w*)\s*(?:\[\[?|\(\(?|\{\{?|>)([^\]\)\}]+?)(?:\]\]?|\)\)?|\}\}?)/g)) {
    if (seen.has(x[1])) continue
    seen.add(x[1]); out.push(tidy(x[2]))
  }
  return out.length ? out.slice(0, 8) : [tidy(m)]
}
