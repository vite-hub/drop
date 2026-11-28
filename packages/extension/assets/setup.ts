import ui from "@nuxt/ui/vue-plugin"
import { createApp, type Component } from "vue"
import "./main.css"

export function mount(App: Component) {
  createApp(App).use(ui).mount("#app")
}
