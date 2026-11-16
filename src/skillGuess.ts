// Which of the skills on this machine does a kind of work: onboarding picks it, Settings offers it.
/** Which skill on this machine is the one for a kind of work, by its name. */
export function guessSkill<T extends { invoke: string; source: string; command: string }>(all: T[], work: 'review' | 'revise' | 'exec'): T | undefined {
  const RE = { review: /^\/?(?!.*(stack|revis|crit-))(.*review.*)$/i, revise: /revis|address|feedback|fix-?pr|respond/i, exec: /exec|ship|ticket|implement/i }[work]
  const mine = all.filter((x) => RE.test(x.invoke.replace(/^\//, '')))
  // yours before a plugin's, the shortest name first (the general one, not a variant)
  return mine.sort((a, b) => Number(a.source !== 'yours') - Number(b.source !== 'yours') || a.invoke.length - b.invoke.length)[0]
}
