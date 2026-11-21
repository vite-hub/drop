import type { CommandPaletteItem } from "@nuxt/ui"
import type { DropSummary } from "#shared/types"
import type { InjectionKey, ShallowRef } from "vue"

interface PaletteDrop {
  groups: { id: string; label: string; items: CommandPaletteItem[] }[]
}
interface PaletteFolder extends Pick<DropSummary, "id" | "title"> {
  folders: boolean
}
interface PaletteContext {
  drop: ShallowRef<PaletteDrop | null>
  folder: ShallowRef<PaletteFolder | null>
  scope: ShallowRef<Pick<DropSummary, "id" | "title"> | null>
}

const KEY: InjectionKey<PaletteContext> = Symbol("palette-context")

export function providePaletteContext() {
  const context: PaletteContext = { drop: shallowRef(null), folder: shallowRef(null), scope: shallowRef(null) }
  provide(KEY, context)
  return context
}

export const injectPaletteContext = () => inject(KEY, null)

export function usePaletteOffer<K extends keyof PaletteContext>(key: K, value: () => PaletteContext[K]["value"]) {
  // SAFETY: PaletteContext[K] is that slot's ShallowRef; TypeScript loses the link between K and its value type.
  const slot = injectPaletteContext()?.[key] as ShallowRef<PaletteContext[K]["value"]> | undefined
  if (!slot) return
  let mine: PaletteContext[K]["value"] = null
  onMounted(() => watchEffect(() => (slot.value = mine = value())))
  onBeforeUnmount(() => {
    if (slot.value === mine) slot.value = null
  })
}

export const usePaletteTerm = () => useState("palette-term", () => "")

export function usePaletteOpener() {
  const term = usePaletteTerm()
  const nuxtApp = useNuxtApp()
  return (value = "") => {
    term.value = value
    void nuxtApp.callHook("dashboard:search:toggle")
  }
}
