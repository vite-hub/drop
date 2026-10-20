const sent = new Set<string>()

/**
 * Tell the server something failed in this browser (server/api/client-errors.post.ts), at most once per message and
 * ten times per page load. It never throws: reporting an error mustn't make another one. On the server it does
 * nothing: the server logs its own errors.
 */
export function reportClientError(action: string, error: unknown) {
  if (import.meta.client) {
    const failure = error instanceof Error ? error : new Error(String(error))
    const key = `${action}:${failure.message}`
    if (sent.has(key) || sent.size >= 10) return
    sent.add(key)
    const body = {
      action,
      path: window.location.pathname.slice(0, 600),
      name: failure.name.slice(0, 120),
      message: failure.message.slice(0, 1000),
      stack: failure.stack?.slice(0, 4000),
    }
    fetch("/api/client-errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {})
  }
}
