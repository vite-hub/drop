import { nextPath } from "#shared/sign-in"

export function useGitHubSignIn() {
  const route = useRoute()
  const { loggedIn, signIn } = useUserSession(useNuxtApp().$auth)

  const mounted = useMounted()
  const signedIn = computed(() => mounted.value && loggedIn.value)

  const appOrigin = useRequestURL().origin
  const next = computed(() => nextPath(textValue(route.query.redirect), appOrigin))

  const signInHref = computed(() => `/signin?redirect=${encodeURIComponent(next.value)}`)

  return { signedIn, next, signIn, signInHref }
}
