export default defineNuxtRouteMiddleware(async (to) => {
  const { data: cached } = useNuxtData(keys.me)
  if (cached.value) {
    reportSignInReturned()
    return
  }
  if (import.meta.server && useRequestHeaders(["cookie"]).cookie?.includes(".session_token=")) {
    void useDropTree(to)
    void useSharedWithMe()
    void usePinned()
  }
  const { data: me } = await useMe()
  if (!me.value) return navigateTo({ path: "/", query: { signin: "1", redirect: to.fullPath } })
  reportSignInReturned()
})
