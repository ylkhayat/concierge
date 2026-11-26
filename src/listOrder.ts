// The lists' orders, total: every tie ends on the id, so two updates of the same items always lay them out the same
// way (a tie left to the input's order reshuffled rows each time the server sent its list in another order).

type MinePr = { id: string; awaiting?: number; unresolved?: number; createdAt: string }
type ReviewPr = { id: string; firstSeenAt: string }
type Ticket = { id: string; priority: number; createdAt: string }

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** Your PRs: the most waiting on you first, then the newest. Not by updatedAt: every push or reply the agent makes
 *  moves it, so rows climbed and sank while it worked. */
export const minePrOrder = (a: MinePr, b: MinePr) =>
  (b.awaiting ?? b.unresolved ?? 0) - (a.awaiting ?? a.unresolved ?? 0) || b.createdAt.localeCompare(a.createdAt) || byId(a, b)

/** Reviews: in the order they came in. */
export const reviewPrOrder = (a: ReviewPr, b: ReviewPr) => a.firstSeenAt.localeCompare(b.firstSeenAt) || byId(a, b)

/** Tickets inside their group: urgent first (no priority last), then the oldest. */
export const ticketOrder = (a: Ticket, b: Ticket) => {
  const prio = (p: number) => (p === 0 ? 5 : p)
  return prio(a.priority) - prio(b.priority) || a.createdAt.localeCompare(b.createdAt) || byId(a, b)
}
