<script setup lang="ts">
// A comment box where "@" suggests people in this Drop, under the caret. Arrows or the pointer choose, Enter or Tab
// writes "@Name ", Escape closes the list and keeps the text. While the list is open those keys belong to it, so Enter
// doesn't send the comment and Escape doesn't close it. Everything else passes through to the textarea.
import { matchPeople, mentionQuery, type Person } from "~/utils/mentions"

defineOptions({ inheritAttrs: false })
const body = defineModel<string>({ required: true })
const props = defineProps<{
  /** Names already in the conversation, suggested first. */
  participants?: string[]
}>()
const { people, me } = usePeople()
const root = useTemplateRef<HTMLElement>("root")
const listId = useId()
const field = () => root.value?.querySelector("textarea") ?? undefined

const at = ref<{ start: number; query: string }>()
// The "@" whose list Escape closed: it stays closed until the caret leaves that mention.
const dismissed = ref<number>()
const active = ref(0)
const place = ref<{ left: number; top: number; bottom: number }>()
// The list leaves for <body>, so in the review dock it takes the dock's dark surface along, as its other overlays do.
const reviewSurface = ref(false)

const ranked = computed(() => {
  const others = people.value.filter((person) => person.id !== me.value)
  const first = new Set(props.participants)
  return [...others.filter((person) => first.has(person.name)), ...others.filter((person) => !first.has(person.name))]
})
const matches = computed(() => (at.value ? matchPeople(ranked.value, at.value.query) : []))
const open = computed(() => Boolean(at.value && matches.value.length && dismissed.value !== at.value.start))
watch(matches, () => (active.value = 0))

function update() {
  const textarea = field()
  if (!textarea || document.activeElement !== textarea || textarea.selectionStart !== textarea.selectionEnd) {
    at.value = undefined
    return
  }
  const found = mentionQuery(textarea.value, textarea.selectionStart)
  if (found?.start !== dismissed.value) dismissed.value = undefined
  at.value = found
  if (!found) return
  place.value = caretBox(textarea, found.start)
  reviewSurface.value = Boolean(textarea.closest(".surface-review"))
}
useEventListener(() => (import.meta.client ? document : undefined), "selectionchange", update)

function keydown(event: KeyboardEvent) {
  if (!open.value || event.isComposing) return
  const count = matches.value.length
  if (event.key === "ArrowDown") active.value = (active.value + 1) % count
  else if (event.key === "ArrowUp") active.value = (active.value - 1 + count) % count
  else if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") void pick(matches.value[active.value]!)
  else if (event.key === "Escape") dismissed.value = at.value!.start
  else return
  event.preventDefault()
  event.stopPropagation()
}

async function pick(person: Person) {
  const textarea = field()
  const mention = at.value
  if (!textarea || !mention) return
  const text = `@${person.name} `
  body.value = body.value.slice(0, mention.start) + text + body.value.slice(textarea.selectionStart).replace(/^ /u, "")
  at.value = undefined
  await nextTick()
  const caret = mention.start + text.length
  textarea.focus()
  textarea.setSelectionRange(caret, caret)
}

// Where the "@" sits on screen: a hidden copy of the textarea's text up to it, wrapped the same way.
function caretBox(textarea: HTMLTextAreaElement, index: number) {
  const style = getComputedStyle(textarea)
  const mirror = document.createElement("div")
  for (const key of [
    "boxSizing",
    "width",
    "padding",
    "borderWidth",
    "borderStyle",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "letterSpacing",
    "lineHeight",
    "wordSpacing",
    "tabSize",
  ] as const)
    mirror.style[key] = style[key]
  Object.assign(mirror.style, {
    position: "fixed",
    top: "0",
    left: "0",
    visibility: "hidden",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
  })
  mirror.textContent = textarea.value.slice(0, index)
  const marker = document.createElement("span")
  marker.textContent = "@"
  mirror.append(marker)
  document.body.append(mirror)
  const box = textarea.getBoundingClientRect()
  const left = box.left + marker.offsetLeft - textarea.scrollLeft
  const top = box.top + marker.offsetTop - textarea.scrollTop
  const bottom = top + marker.offsetHeight
  mirror.remove()
  return { left, top, bottom }
}

const viewport = useWindowSize()
const menu = useTemplateRef<HTMLElement>("menu")
const { height } = useElementSize(menu)
// Under the "@" when the list fits there, else above it; never off either side.
const style = computed(() => {
  if (!place.value) return {}
  const left = Math.max(8, Math.min(place.value.left - 8, viewport.width.value - 256 - 8))
  const below = place.value.bottom + 6 + height.value <= viewport.height.value - 8
  return below
    ? { left: `${left}px`, top: `${place.value.bottom + 6}px` }
    : { left: `${left}px`, bottom: `${viewport.height.value - place.value.top + 6}px` }
})
watch(active, async (index) => {
  await nextTick()
  menu.value?.children[index]?.scrollIntoView({ block: "nearest" })
})
</script>

<template>
  <div ref="root" class="contents" @focusout="at = undefined" @input="update" @keydown.capture="keydown">
    <UTextarea
      v-model="body"
      v-bind="$attrs"
      :aria-activedescendant="open ? `${listId}-${active}` : undefined"
      aria-autocomplete="list"
      :aria-controls="open ? listId : undefined"
      :aria-expanded="open"
      role="combobox"
    />
    <Teleport to="body">
      <ul
        v-if="open"
        :id="listId"
        ref="menu"
        aria-label="People"
        class="fixed z-50 max-h-60 w-64 overflow-y-auto overscroll-contain rounded-lg border border-default p-1 shadow-lg motion-safe:[animation:pop-in_120ms_var(--ease-out)]"
        :class="reviewSurface ? 'surface-review bg-(--review-surface)' : 'bg-default'"
        role="listbox"
        :style="style"
        @mousedown.prevent
      >
        <li
          v-for="(person, index) in matches"
          :id="`${listId}-${index}`"
          :key="person.id"
          :aria-selected="index === active"
          class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm pointer-coarse:min-h-11"
          :class="index === active ? 'bg-elevated text-highlighted' : 'text-default'"
          role="option"
          @click="pick(person)"
          @pointermove="active = index"
        >
          <UAvatar :alt="person.name" :src="person.image ?? undefined" size="2xs" />
          <span class="truncate">{{ person.name }}</span>
        </li>
      </ul>
    </Teleport>
  </div>
</template>
