import { signInPath } from "./sign-in"

export function contentUnavailable(
  status: number,
  path: string,
  email?: string | null,
  waitingForReview = false,
  authProxy = false,
) {
  const signIn = signInPath(path, { proxy: authProxy, choose: true })
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
  const thing = path.startsWith("/f/") ? "file" : "drop"
  if (email)
    return {
      title: `You can't open this ${thing}`,
      description: `It isn't shared with this account, or it was deleted. Ask whoever sent the link to share it with you.`,
      email,
      action: authProxy
        ? { label: "My drops", to: "/drops" }
        : { label: "Use another account", to: `/signin?redirect=${encodeURIComponent(path)}` },
    }
  return {
    title: `Sign in to open this ${thing}`,
    description: `${thing === "file" ? "Files" : "Drops"} shared with you or your team open right after you sign in.`,
    email: null,
    action: { label: "Sign in with GitHub", to: signIn },
  }
}

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
