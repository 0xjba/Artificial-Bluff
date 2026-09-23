/**
 * Which pages of a paper are on screen: `perView` at a time (two side by side on a wide screen), each
 * spread starting on an odd page (1-2, 3-4 ...), and the last spread allowed to hold a single page.
 */
export function spread(first: number, perView: number, total: number): { pages: number[]; canBack: boolean; canForward: boolean } {
  const clamped = Math.min(Math.max(1, first), Math.max(1, total))
  const start = perView === 2 ? clamped - ((clamped - 1) % 2) : clamped
  const pages = Array.from({ length: perView }, (_, i) => start + i).filter((p) => p <= total)
  return { pages, canBack: start > 1, canForward: start + perView <= total }
}

/** The first page after stepping `by` spreads (never before page 1, never past the last page). */
export const stepFrom = (first: number, by: number, perView: number, total: number) => Math.min(Math.max(1, first + by * perView), Math.max(1, total))
