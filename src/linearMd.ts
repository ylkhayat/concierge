/**
 * Linear writes looser markdown than CommonMark: bold that ends in a space ("**Issue: **") and table cells holding
 * code with a pipe in it ("`waad|abc`"). Tidy both so they render as Linear shows them; everything else is untouched.
 */
export function linearMd(text: string): string {
  return text.split('\n').map((line) => {
    // pair the ** on a line in order; a space just inside a pair moves outside it
    const parts = line.split('**')
    if (parts.length > 2 && parts.length % 2 === 1) {
      for (let i = 1; i < parts.length; i += 2) {
        const lead = parts[i].match(/^\s*/)![0], trail = parts[i].match(/\s*$/)![0]
        if (!lead && !trail) continue
        parts[i] = parts[i].trim()
        parts[i - 1] += lead
        parts[i + 1] = trail + parts[i + 1]
      }
      line = parts.join('**')
    }
    // a pipe inside code in a table row would end the cell
    return /^\s*\|/.test(line) ? line.replace(/`[^`\n]*`/g, (code) => code.replace(/(?<!\\)\|/g, '\\|')) : line
  }).join('\n')
}
