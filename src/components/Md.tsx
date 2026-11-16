import Markdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { here, hereIn } from '../lib.ts'
import { linearMd } from '../linearMd.ts'

/**
 * Markdown from Linear (tickets, comments), GitHub-flavoured: tables, task lists, autolinks; a single newline breaks the line, as in Linear.
 * react-markdown never renders raw HTML and drops unsafe link protocols, so ticket text can't inject anything.
 */
export function Md({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`prose ${className}`}>
      <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={{ a: ({ node: _, href, ...p }) => <a {...p} href={href && here(href)} target="_blank" rel="noreferrer" /> }}>
        {linearMd(hereIn(text))}
      </Markdown>
    </div>
  )
}
