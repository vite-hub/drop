/**
 * Signs out from the account menu or the ⌘K palette. Comments that haven't gone out yet can't be sent once the person
 * is gone, so it asks first, and discards them on yes.
 */
export function useSignOut() {
  const { signOut } = useUserSession(useNuxtApp().$auth)
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
      await outbox.clear()
    }
    await signOut()
    // Leave first: cleared data would flash the dashboard's empty defaults for a frame. /home, not /: / sends whoever
    // it still thinks is signed in to their drops.
    await navigateTo("/home")
    clearNuxtData()
  }
}
