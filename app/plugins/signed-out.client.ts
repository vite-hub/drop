export default defineNuxtPlugin(() => {
  const { data: me } = useNuxtData(keys.me)
  const toast = useToast()
  const route = useRouter().currentRoute
  let checking: Promise<void> | undefined

  async function check() {
    await refreshNuxtData(keys.me)
    if (me.value) return
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

  // SAFETY: $fetch.create keeps Nuxt's $fetch and its defaults, only with this hook; Nuxt's type adds the route typing.
  Object.assign(globalThis, {
    $fetch: $fetch.create({
      onResponseError({ request, response }) {
        if (response.status !== 401 || !me.value) return
        const url = new URL(typeof request === "string" ? request : request.url, location.origin)
        if (url.origin !== location.origin || url.pathname === "/api/me") return
        checking ??= check().finally(() => (checking = undefined))
      },
    }) as typeof $fetch,
  })
})
