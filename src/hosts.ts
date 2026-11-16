// Where links to the machine running it go. Agents and crit print http://localhost:<port>, which is right only in a
// browser on that machine; anywhere else (your laptop, your phone) it is the host the dashboard was opened on. When
// several machines share one link (fleet.ts `reach`), a page opened at <from>… reaches this machine at <to>….

export type Reach = { from: string; to: string }

/** The host to reach the machine running it from the page at `page`. */
export const serverHost = (page: string, reach?: Reach) =>
  reach && page.startsWith(reach.from) ? reach.to + page.slice(reach.from.length) : page

const LOCAL = /^(https?:\/\/)(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?=[:/?#]|$)/i

/** A link an agent printed for "this machine", made to work from the browser it is shown in. */
export const reachable = (url: string, page: string, reach?: Reach) =>
  LOCAL.test(url) && page !== 'localhost' && page !== '127.0.0.1' ? url.replace(LOCAL, (_, scheme: string) => scheme + serverHost(page, reach)) : url

/** Every such link in a piece of text, wherever it sits (bare, in **bold**, in `code`), so what you read is where it goes. */
export const reachableIn = (text: string, page: string, reach?: Reach) =>
  text.replace(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?=[:/?#\s`*)\]]|$)/gi, (u) => reachable(u, page, reach))
