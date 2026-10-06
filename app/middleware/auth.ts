
// Pages behind sign-in. Shared drops (/d/:id) and the landing page stay public.
export default defineNuxtRouteMiddleware(async () => {
  const { loggedIn, pending } = useUserSession()
  if (import.meta.server) return
  if (pending.value) await until(pending).toBe(false)
  if (!loggedIn.value) return navigateTo("/?signin=1")
})
