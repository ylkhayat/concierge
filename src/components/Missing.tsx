import { PackageX } from 'lucide-react'
import { inSettings } from '../copy.ts'

/** Why a button is off: the skills its command needs that this machine lacks, and how to get them. */
export const missingTitle = (names: string[]) =>
  `Needs ${names.map((n) => `/${n}`).join(', ')}, missing on this machine. Add ${names.length === 1 ? 'it' : 'them'} to ~/.claude/skills (or ~/.claude/commands), or sync your skills repo.`

export function Missing({ names, className = '' }: { names?: string[]; className?: string }) {
  if (!names?.length) return null
  return (
    <p className={`flex items-start gap-1.5 text-meta leading-snug text-fail-text ${className}`}>
      <PackageX className="mt-px size-3.5 shrink-0" />
      <span>
        Needs <span className="font-mono">{names.map((n) => `/${n}`).join(', ')}</span>, missing on this machine. Add {names.length === 1 ? 'it' : 'them'} to{' '}
        <span className="font-mono">~/.claude/skills</span> or sync your skills repo; {inSettings('workflows')} lists what this setup runs.
      </span>
    </p>
  )
}
