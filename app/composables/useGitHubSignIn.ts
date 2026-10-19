/**
 * GitHub sign-in for the public pages (landing and docs). After signing in, people go back to where the auth
 * guard sent them from (`?redirect=`), only for same-site paths, never a full URL; otherwise to /drops.
 */
export function useGitHubSignIn() {
  const route = useRoute()
  const notify = useNotify()
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
    }
    catch {
      return "/drops"
    }
  })

  async function signInWithGitHub() {
    const { error } = await signIn.social({ provider: "github", callbackURL: next.value })
    if (error) notify.fail("Couldn't start GitHub sign-in", error)
  }

  return { signedIn, next, signIn, signInWithGitHub }
}
