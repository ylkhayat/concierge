/**
 * A background shell command, in a few words: the command that does the work, without the setup around it
 * ("B=…; cd $B && pnpm nx test ai-core > /tmp/t.log 2>&1" → "pnpm nx test ai-core").
 */
export function brief(cmd: string): string {
  // a loop that waits for logs to say they're done: what it waits for is the news, not its grep
  if (/\b(?:until|while)\b/.test(cmd) && /\bsleep\b/.test(cmd)) {
    const files = [...new Set(cmd.match(/[\w./$-]+\.(?:log|txt|json|out)\b/g)?.map((f) => f.split('/').at(-1)!) ?? [])]
    if (files.length) return `waits for ${files.join(', ')} to finish`
  }
  const parts = cmd.split(/\s*(?:&&|\|\||;|\n)\s*/).map((p) => p
    .replace(/^(?:\w+=(?:"[^"]*"|'[^']*'|\S*)\s+)+/, '') // VAR=value before the command
    .replace(/\s*(?:\d?>>?|&>|<)\s*\S+/g, '') // redirections
    .replace(/\s*\|.*$/, '') // what it pipes into
    .replace(/^(?:(?:nohup|setsid|time|exec)\s+|env(?:\s+-u\s+\S+|\s+\w+=\S*)*\s+)+/, '') // wrappers
    .replace(/\s*&$/, '')
    .trim())
  const work = parts.filter((p) => p && !/^(?:\w+=\S*|cd|export|source|\.|set|echo|sleep|mkdir|rm|true|do|done|then|fi|else)\b/.test(p))
  return (work.at(-1) ?? parts.findLast(Boolean) ?? cmd).slice(0, 120)
}

