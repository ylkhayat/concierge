// A value as one word of a shell command, whatever it holds. Single quotes: nothing inside them is read by the shell
// (no $(…), no backticks, no variables), unlike the double quotes of a JSON string; a quote inside is closed, escaped
// and opened again.
export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
