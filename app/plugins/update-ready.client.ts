export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hooks.hookOnce("app:manifest:update", () => {
    useUpdateReady().value = true
  })
})
