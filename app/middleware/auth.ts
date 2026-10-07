// Pages behind sign-in. Shared drops (/d/:id) and the landing page stay public.
// Runs on the server too: /api/me reads the session cookie, so signed-out visitors are redirected before
// any HTML renders (Better Auth's client session only exists after hydration).
export default defineNuxtRouteMiddleware(async (to) => {
  const { data: cached } = useNuxtData("me")
  if (cached.value) return
  const { data: me } = await useMe()
  if (!me.value) return navigateTo({ path: "/", query: { signin: "1", redirect: to.fullPath } })
})
