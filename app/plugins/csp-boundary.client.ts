import { isDropPage } from "#shared/csp"

export default defineNuxtPlugin(() => {
  if (isDropPage(window.location.pathname)) return
  useRouter().beforeEach((to) => {
    if (!isDropPage(to.path)) return
    window.location.assign(to.fullPath)
    return false
  })
})
