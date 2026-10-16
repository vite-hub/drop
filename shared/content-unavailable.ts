/** Recovery guidance never depends on the hidden content or its owner's identity. */
export function contentUnavailable(status: number, path: string, email?: string | null, waitingForReview = false, authProxy = false) {
  const signIn = `/signin?redirect=${encodeURIComponent(path)}`
  if (status >= 500 || status === 429) return {
    title: status === 429 ? "Too many requests." : "Could not open this content.",
    description: "Try again in a moment.",
    email: null,
    action: { label: "Try again", to: path },
  }
  if (status === 410) return {
    title: "This drop expired.",
    description: "Nobody opened it for a while, so it stopped being served. Its owner can still renew it for a few days.",
    email: null,
    action: email ? { label: "My drops", to: "/drops" } : { label: "Sign in with GitHub", to: signIn },
  }
  if (waitingForReview) return {
    title: "Waiting for review",
    description: "This share is waiting for the instance operator to review it.",
    email: null,
    action: { label: "Home", to: "/" },
  }
  // Behind an auth proxy, signing in again returns the same GitHub account to the same page: a loop, not a fix.
  if (email && authProxy) return {
    title: "This content isn't available to your account.",
    description: "It may be private to its owner, or deleted. If someone sent you the link, ask them to share it.",
    email,
    action: { label: "My drops", to: "/drops" },
  }
  return {
    title: email ? "This content isn't available to your account." : "This content may be private or deleted.",
    description: "Sign in with the GitHub account you used to connect your agent on this Drop site. If someone sent you the link, ask them to share it.",
    email: email ?? null,
    action: { label: email ? "Use another account" : "Sign in with GitHub", to: signIn },
  }
}
