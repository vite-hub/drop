import UTooltip from "@nuxt/ui/components/Tooltip.vue"

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.component("UTooltip", UTooltip)
})
