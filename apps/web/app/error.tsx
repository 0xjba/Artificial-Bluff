'use client' // error boundaries must be client components

/** Shown instead of a page that failed to render (e.g. the live server is unreachable). */
export default function PageError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <section className="page">
      <h1>Something went wrong</h1>
      <p className="muted">The page could not be shown. The live server may be restarting.</p>
      <button type="button" className="retry" onClick={() => retry()}>
        Try again
      </button>
    </section>
  )
}
