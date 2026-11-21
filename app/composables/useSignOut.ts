import { RETURNING_COOKIE } from "#shared/sign-in"

/**
 * Signs out from the account menu or the ⌘K palette. Comments that haven't gone out yet can't be sent once the person
 * is gone, so it asks first, and discards them on yes.
 */
export function useSignOut() {
  const { signOut } = useUserSession(useNuxtApp().$auth)
  // Signed out on purpose: a drop link shouldn't sign this browser in again by itself
  // (server/handlers/content-error.ts).
  const returning = useCookie(RETURNING_COOKIE)
  const outbox = useCommentsOutbox()
  const confirm = useConfirm()
  return async () => {
    const count = outbox.entries.value.length
    if (count) {
      const discard = await confirm({
        title: `${count} ${count === 1 ? "comment isn't" : "comments aren't"} sent. Sign out and discard ${count === 1 ? "it" : "them"}?`,
        confirmLabel: "Sign out",
        destructive: true,
      })
      if (!discard) return
    }
    // Also forgets whose comments they were, so the next person in this browser doesn't see them held.
    await outbox.clear()
    await Promise.resolve(signOut())
    returning.value = null
    // Leave first: cleared data would flash the dashboard's empty defaults for a frame. /home, not /: / sends whoever
    // it still thinks is signed in to their drops.
    await navigateTo("/home")
    clearNuxtData()
  }
}
