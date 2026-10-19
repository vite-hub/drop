import { isDropPage } from "#shared/csp"

// A CSP comes with the document, not the route. A page loaded with the script policy keeps it for every page the router
// shows next, and a drop's page under it would block its drops' scripts (shared/csp.ts). So from such a page, opening a
// drop's page loads it fresh. Once on a drop's page, the router moves anywhere.
export default defineNuxtPlugin(() => {
  if (isDropPage(window.location.pathname)) return
  useRouter().beforeEach((to) => {
    if (!isDropPage(to.path)) return
    window.location.assign(to.fullPath)
    return false
  })
})
