/**
 * GitHub sign-in for the public pages (landing and docs). After signing in, people go back to where the auth
 * guard sent them from (`?redirect=`), only for same-site paths, never a full URL; otherwise to /drops.
 */
export function useGitHubSignIn() {
  const route = useRoute()
  const toast = useToast()
  const { loggedIn, signIn } = useUserSession()

  // The session loads client-side; gate on mount so the server and first client render agree.
  const mounted = useMounted()
  const signedIn = computed(() => mounted.value && loggedIn.value)

  const appOrigin = useRequestURL().origin
  const next = computed(() => {
    const value = route.query.redirect
    if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/drops"
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
    if (error) toast.add({ title: error.message ?? "Couldn't start GitHub sign-in.", color: "error" })
  }

  return { signedIn, next, signIn, signInWithGitHub }
}

/**
 * This Drop's origin, for snippets like the MCP server URL. Prerendered pages (the docs) are built without a
 * request, so their HTML says drop.vitehub.dev and switches to the real origin once the page hydrates.
 */
export function useSiteOrigin() {
  const origin = useState("site-origin", () => (import.meta.prerender ? "https://drop.vitehub.dev" : useRequestURL().origin))
  onMounted(() => (origin.value = window.location.origin))
  return origin
}
