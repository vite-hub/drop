import type { CommandPaletteItem } from "@nuxt/ui"
import type { DropSummary } from "#shared/types"
import type { InjectionKey, ShallowRef } from "vue"

/** The drop open on the page, offered to the ⌘K palette (SearchPalette): its title and what you can do with it. */
interface PaletteDrop {
  title: string
  items: CommandPaletteItem[]
}
/** The folder open on the page, which ⌘K's new drops go into. `folders`: whether you may add folders to it too. */
interface PaletteFolder extends Pick<DropSummary, "id" | "title"> {
  folders: boolean
}
interface PaletteContext {
  drop: ShallowRef<PaletteDrop | null>
  folder: ShallowRef<PaletteFolder | null>
}

const KEY: InjectionKey<PaletteContext> = Symbol("palette-context")

/** The dashboard layout holds the context; the page inside it fills it in, and the palette beside the page reads it. */
export function providePaletteContext() {
  const context: PaletteContext = { drop: shallowRef(null), folder: shallowRef(null) }
  provide(KEY, context)
  return context
}

export const injectPaletteContext = () => inject(KEY, null)

/**
 * Offers `value` to the palette while the calling component is mounted. The next drop's viewer can mount before the
 * last one unmounts, so leaving clears the slot only when it still holds this component's value. Pages outside the
 * dashboard layout have no palette, and nothing happens.
 */
export function offerToPalette<K extends keyof PaletteContext>(key: K, value: () => PaletteContext[K]["value"]) {
  // SAFETY: PaletteContext[K] is that slot's ShallowRef; TypeScript loses the link between K and its value type.
  const slot = injectPaletteContext()?.[key] as ShallowRef<PaletteContext[K]["value"]> | undefined
  if (!slot) return
  let mine: PaletteContext[K]["value"] = null
  onMounted(() => watchEffect(() => (slot.value = mine = value())))
  onBeforeUnmount(() => {
    if (slot.value === mine) slot.value = null
  })
}
