// Each deploy gets a new Nuxt build id. Nuxt compares it on an interval (experimental.checkOutdatedBuildInterval)
// and calls `app:manifest:update` when a newer build is out, like Nuxt Studio's "Update ready" (UpdateReady.vue).
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hooks.hookOnce("app:manifest:update", () => {
    useUpdateReady().value = true
  })
})
