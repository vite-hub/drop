import { nextPath } from "#shared/sign-in"

/**
 * GitHub sign-in for the public pages (landing and docs). After signing in, people go back to where the auth
 * guard sent them from (`?redirect=`), only for same-site paths, never a full URL; otherwise to /drops.
 */
export function useGitHubSignIn() {
  const route = useRoute()
  const { loggedIn, signIn } = useUserSession(useNuxtApp().$auth)

  // The session loads client-side; gate on mount so the server and first client render agree.
  const mounted = useMounted()
  const signedIn = computed(() => mounted.value && loggedIn.value)

  const appOrigin = useRequestURL().origin
  const next = computed(() => nextPath(textValue(route.query.redirect), appOrigin))

  const signInHref = computed(() => `/signin?redirect=${encodeURIComponent(next.value)}`)

  return { signedIn, next, signIn, signInHref }
}
