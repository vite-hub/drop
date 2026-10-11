/** Recovery guidance never depends on the hidden content or its owner's identity. */
export function contentUnavailable(status: number, path: string, email?: string | null, waitingForReview = false) {
  const signIn = `/signin?redirect=${encodeURIComponent(path)}`
  if (status >= 500 || status === 429) return {
    title: status === 429 ? "Too many requests." : "Could not open this content.",
    description: "Try again in a moment.",
    email: null,
    action: { label: "Try again", to: path },
  }
  if (waitingForReview) return {
    title: "Waiting for review",
    description: "This share is waiting for the instance operator to review it.",
    email: null,
    action: { label: "Home", to: "/" },
  }
  return {
    title: email ? "This content isn't available to your account." : "This content may be private or deleted.",
    description: "Sign in with the GitHub account you used to connect your agent on this Drop site. If someone sent you the link, ask them to share it.",
    email: email ?? null,
    action: { label: email ? "Use another account" : "Sign in with GitHub", to: signIn },
  }
}
