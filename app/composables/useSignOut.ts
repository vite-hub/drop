import { RETURNING_COOKIE } from "#shared/sign-in"

/** Signs out from the account menu or the ⌘K palette. */
export function useSignOut() {
  const { signOut } = useUserSession(useNuxtApp().$auth)
  // Signed out on purpose: a drop link shouldn't sign this browser in again by itself
  // (server/handlers/content-error.ts).
  const returning = useCookie(RETURNING_COOKIE)
  return async () => {
    await signOut()
    returning.value = null
    // Leave first: cleared data would flash the dashboard's empty defaults for a frame. /home, not /: / sends whoever
    // it still thinks is signed in to their drops.
    await navigateTo("/home")
    clearNuxtData()
  }
}
