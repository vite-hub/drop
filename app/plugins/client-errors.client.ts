// Uncaught errors reach the server's logs too, not only the console of whoever saw them.
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook("vue:error", (error) => reportClientError("vue", error))
  nuxtApp.hook("app:error", (error) => reportClientError("app", error))
  window.addEventListener("unhandledrejection", (event) => reportClientError("unhandled", event.reason))
})
