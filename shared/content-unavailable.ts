import { signInPath } from "./sign-in"

/** Recovery guidance never depends on the hidden content or its owner's identity. */
export function contentUnavailable(
  status: number,
  path: string,
  email?: string | null,
  waitingForReview = false,
  authProxy = false,
) {
  const signIn = signInPath(path)
  if (status >= 500 || status === 429)
    return {
      title: status === 429 ? "Too many requests." : "Could not open this content.",
      description: "Try again in a moment.",
      email: null,
      action: { label: "Try again", to: path },
    }
  if (status === 410)
    return {
      title: "This drop expired.",
      description:
        "Nobody opened it for a while, so it stopped being served. Its owner can still renew it for a few days.",
      email: null,
      action: email ? { label: "My drops", to: "/drops" } : { label: "Sign in with GitHub", to: signIn },
    }
  if (waitingForReview)
    return {
      title: "Waiting for review",
      description: "This share is waiting for the instance operator to review it.",
      email: null,
      action: { label: "Home", to: "/" },
    }
  // Behind an auth proxy, signing in again returns the same GitHub account to the same page: a loop, not a fix.
  if (email && authProxy)
    return {
      title: "This content isn't available to your account.",
      description: "It may be private to its owner, or deleted. If someone sent you the link, ask them to share it.",
      email,
      action: { label: "My drops", to: "/drops" },
    }
  if (email)
    return {
      title: "This content isn't available to your account.",
      description:
        "It may be private to its owner, or deleted. If someone sent you the link, ask them to share it with you, or sign in with another account.",
      email,
      action: { label: "Use another account", to: `/signin?redirect=${encodeURIComponent(path)}` },
    }
  // Most people who land here signed out were sent a team link they can open: lead with signing in. A private, team or
  // deleted drop all answer the same 404, so the words fit each and tell nobody which one this is.
  return {
    title: `Sign in to open this ${path.startsWith("/f/") ? "file" : "drop"}`,
    description:
      "If it was shared with you or your team, it opens once you sign in. Otherwise it may be private or deleted.",
    email: null,
    action: { label: "Sign in with GitHub", to: signIn },
  }
}

/**
 * A 404 under a drop this person may open: the drop is there, only the address isn't, so nothing about access or
 * accounts applies. `drop` is the drop's own link.
 */
export const missingInDrop = (drop: string, email?: string | null) => ({
  title: "Nothing is at this address in the drop.",
  description: "The drop is here, and you can open it, but it has no page at this address.",
  email: email ?? null,
  action: { label: "Open the drop", to: drop },
})

export function contentUnavailableIcon(status: number, waitingForReview = false) {
  if (status >= 500 || status === 429)
    return "m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0M12 9v4m0 4h.01"
  if (status === 410 || waitingForReview) return "M12 8v4l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0"
  return "M7 10V7a5 5 0 0 1 10 0v3M6 10h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2m6 5v2"
}
