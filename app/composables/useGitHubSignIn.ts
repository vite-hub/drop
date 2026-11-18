/**
 * GitHub sign-in for the public pages (landing and docs). After signing in, people go back to where the auth
 * guard sent them from (`?redirect=`), only for same-site paths, never a full URL; otherwise to /drops.
 * `signInHref` is ViteHub's sign-in route (`access.signIn` in server/auth.ts), so the link works before hydration.
 */
export function useGitHubSignIn() {
  const route = useRoute()
  const { loggedIn, signIn } = useUserSession(useNuxtApp().$auth)

  // The session loads client-side; gate on mount so the server and first client render agree.
  const mounted = useMounted()
  const signedIn = computed(() => mounted.value && loggedIn.value)

  const appOrigin = useRequestURL().origin
  const next = computed(() => {
    const value = textValue(route.query.redirect)
    if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/drops"
    try {
      const resolved = new URL(value, appOrigin)
      if (resolved.origin !== appOrigin) return "/drops"
      return `${resolved.pathname}${resolved.search}${resolved.hash}`
    } catch {
      return "/drops"
    }
  })

  const signInHref = computed(() => `/api/auth/sign-in?redirect=${encodeURIComponent(next.value)}`)

  return { signedIn, next, signIn, signInHref }
}
