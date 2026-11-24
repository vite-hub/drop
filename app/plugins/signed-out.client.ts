export default defineNuxtPlugin(() => {
  const { data: me } = useNuxtData(keys.me)
  const toast = useToast()
  const route = useRouter().currentRoute
  const fetch = globalThis.fetch
  let checking: Promise<void> | undefined

  async function check() {
    const who = await $fetch("/api/me").then(
      (value) => value || null,
      () => undefined,
    )
    if (who !== null) return
    me.value = null
    toast.add({
      id: "signed-out",
      title: "You're signed out",
      description: "Sign in again to keep working.",
      icon: "i-mingcute-exit-line",
      duration: 0,
      actions: [
        {
          label: "Sign in",
          onClick: () => void navigateTo({ path: "/signin", query: { redirect: route.value.fullPath } }),
        },
      ],
    })
  }

  // SAFETY: Nuxt's client $fetch, useFetch and the auth client all call globalThis.fetch per request; this only watches the answers.
  globalThis.fetch = async (input, init) => {
    const response = await fetch(input, init)
    if (response.status !== 401 || !me.value) return response
    const url = new URL(input instanceof Request ? input.url : input, location.href)
    if (url.origin === location.origin && url.pathname !== "/api/me")
      checking ??= check().finally(() => (checking = undefined))
    return response
  }
})
