/** Signs out from the account menu or the ⌘K palette. */
export function useSignOut() {
  const { signOut } = useUserSession(useNuxtApp().$auth)
  return async () => {
    await signOut()
    // Leave first: cleared data would flash the dashboard's empty defaults for a frame. /home, not /: / sends whoever
    // it still thinks is signed in to their drops.
    await navigateTo("/home")
    clearNuxtData()
  }
}
