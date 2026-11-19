import type { CommentUser } from "vite-hub/comments/client"

/** Where a drop's unsent words wait in this browser, so a crash or a reload keeps them. */
const draftKey = (drop: string) => `drop-review-draft:${drop}`
function readDraft(drop: string) {
  try {
    return localStorage.getItem(draftKey(drop)) ?? ""
  } catch {
    return ""
  }
}
function saveDraft(drop: string, text: string) {
  try {
    if (text) localStorage.setItem(draftKey(drop), text)
    else localStorage.removeItem(draftKey(drop))
  } catch {
    // Storage is full or blocked: the words still live in the page.
  }
}

/**
 * The new comment being written on `drop`. It keeps its text and images when the reviewer adds or removes an area, and
 * its text across a reload. A send clears it at once (the comment waits in the outbox, useDrop), so the next one can
 * start while the first is still on its way.
 */
export const [provideReviewDraft, injectReviewDraft] = createInjectionState((drop?: () => string) => {
  const body = ref("")
  const images = useImagePicks()
  const mentions = ref<string[]>([])
  const people = ref<CommentUser[]>([])
  async function rememberPeople(found: CommentUser[]) {
    // Mention lookup starts in input capture. Wait for the target input handler to save the native text
    // before publishing reactive people (a microtask can still run between those event handlers).
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    people.value = [...new Map([...people.value, ...found].map((person) => [person.id, person])).values()]
    return found
  }
  watch(
    body,
    (text) => {
      if (!text) {
        mentions.value = []
        people.value = []
      }
    },
    { flush: "sync" },
  )
  if (drop) {
    // Only in the browser, after hydration renders the same empty box the server did.
    onMounted(() => {
      watch(
        drop,
        (id) => {
          if (!body.value) body.value = readDraft(id)
        },
        { immediate: true },
      )
      watch(body, (text) => saveDraft(drop(), text))
    })
  }
  // Waiting for the picture of the area being commented on before it sends (DropViewer's submit).
  const waiting = ref(false)

  /** Empties the draft once its comment is in the outbox. */
  function clear() {
    body.value = ""
    images.clear()
  }

  return { body, images, mentions, people, rememberPeople, waiting, clear }
})
