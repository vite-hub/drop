// Starts the app's comments outbox (useCommentsOutbox) on every page, so what an earlier page saved goes out and the
// tab-close guard counts it, wherever the reader is.
export default defineNuxtPlugin(() => {
  useCommentsOutbox()
})
