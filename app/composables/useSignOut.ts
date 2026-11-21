import { RETURNING_COOKIE } from "#shared/sign-in"

export function useSignOut() {
  const { signOut } = useUserSession(useNuxtApp().$auth)
  const returning = useCookie(RETURNING_COOKIE)
  const outbox = useCommentsOutbox()
  const confirm = useConfirm()
  return async () => {
    const account = outbox.account.value
    const count = outbox.entries.value.length
    if (count) {
      const discard = await confirm({
        title: `${count} ${count === 1 ? "comment isn't" : "comments aren't"} sent. Sign out and discard ${count === 1 ? "it" : "them"}?`,
        confirmLabel: "Sign out",
        destructive: true,
      })
      if (!discard) return
      await outbox.clear(account)
    }
    await Promise.resolve(signOut())
    returning.value = null
    await navigateTo("/home")
    clearNuxtData()
  }
}
