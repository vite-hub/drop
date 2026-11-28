import { Icon, addCollection, addIcon as addOfflineIcon } from "@iconify/vue/offline"
import type { IconifyIcon } from "@iconify/vue/offline"

const loaded = new Set<string>()

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
