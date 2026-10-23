// Each deploy gets a new Nuxt build id. Nuxt compares it on an interval (experimental.checkOutdatedBuildInterval)
// and calls `app:manifest:update` when a newer build is out, like Nuxt Studio's "Update ready".
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hooks.hookOnce("app:manifest:update", () => {
    useNotify().info({
      title: "Update ready",
      description: "A new version of Drop is out.",
      icon: "i-mingcute-refresh-2-line",
      // The toast stays: the open page keeps the old version until a reload.
      duration: 0,
      // One short line, so Reload sits beside it instead of on a row of its own.
      orientation: "horizontal",
      actions: [{ label: "Reload", color: "neutral", variant: "outline", onClick: () => reloadNuxtApp() }],
    })
  })
})
