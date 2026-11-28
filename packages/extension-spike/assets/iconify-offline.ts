// Nuxt UI's Vue <UIcon> imports `Icon`, `iconLoaded` and `addIcon` from `@iconify/vue`, whose online build
// carries the api.iconify.design loader. MV3 forbids remote code and the icons are bundled anyway, so the
// build aliases `@iconify/vue` to this file: the offline build plus the one helper it lacks.
import { Icon, addCollection, addIcon as addOfflineIcon } from "@iconify/vue/offline"
import type { IconifyIcon } from "@iconify/vue/offline"

const loaded = new Set<string>()

// The offline <Icon> looks names up verbatim, and <UIcon> asks for "mingcute-chat-3-line" while Nuxt UI
// registers "mingcute:chat-3-line", so store both spellings.
export function addIcon(name: string, data: IconifyIcon) {
  for (const key of new Set([name, name.replace(":", "-")])) {
    loaded.add(key)
    addOfflineIcon(key, data)
  }
}

export function iconLoaded(name: string) {
  return loaded.has(name)
}

export { Icon, addCollection }
