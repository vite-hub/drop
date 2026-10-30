// Pages behind sign-in. Shared drops (/d/:id) and the landing page stay public.
// Runs on the server too: /api/me reads the session cookie, so signed-out visitors are redirected before
// any HTML renders (Better Auth's client session only exists after hydration).
export default defineNuxtRouteMiddleware(async (to) => {
  const { data: cached } = useNuxtData(keys.me)
  if (cached.value) return
  // Every page behind sign-in has the dashboard layout, which lists your drops and what's shared with you. Started with
  // /api/me instead of after it, the server render waits for one round trip less. Only with a session cookie (Better
  // Auth's, whatever its prefix), so a signed-out visit's redirect doesn't log two refused lists first.
  if (import.meta.server && useRequestHeaders(["cookie"]).cookie?.includes(".session_token=")) {
    void useDrops()
    void useSharedWithMe()
  }
  const { data: me } = await useMe()
  if (!me.value) return navigateTo({ path: "/", query: { signin: "1", redirect: to.fullPath } })
})
