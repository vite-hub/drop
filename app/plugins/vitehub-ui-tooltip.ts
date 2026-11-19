import UTooltip from "@nuxt/ui/components/Tooltip.vue"

// vite-hub/ui's parts (the selection bar's Comment and Suggest) show Nuxt UI's tooltip only when they find UApp's
// tooltip provider. They look for it with their own reka-ui (2.11), while Nuxt UI provides it with its 2.10.3, so they
// never find it and fall back to a `title`. A UTooltip registered by name is the one they render, and Nuxt UI's own
// reads UApp's provider.
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.component("UTooltip", UTooltip)
})
