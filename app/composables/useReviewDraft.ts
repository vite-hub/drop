import type { CommentUser } from "vite-hub/comments/client"

/** Where a drop's unsent words wait in this browser, so a crash or a reload keeps them. */
function readDraft(key: string) {
  try {
    return localStorage.getItem(key) ?? ""
  } catch {
    return ""
  }
}
function saveDraft(key: string, text: string) {
  try {
    if (text) localStorage.setItem(key, text)
    else localStorage.removeItem(key)
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
  const session = drop ? useMe() : undefined
  const scope = computed(() => JSON.stringify([session?.data.value?.id ?? null, drop?.()]))
  async function rememberPeople(found: CommentUser[]) {
    const owner = scope.value
    // Mention lookup starts in input capture. Wait for the target input handler to save the native text
    // before publishing reactive people (a microtask can still run between those event handlers).
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    if (scope.value !== owner) return []
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
  if (session) {
    // Only in the browser, after hydration renders the same empty box the server did.
    onMounted(() => {
      let key: string | undefined
      let ready = false
      watch(
        [scope, session.status],
        ([owner, state]) => {
          ready ||= state === "success"
          if (!ready) return
          const next = `drop-review-draft:v2:${owner}`
          if (key === next) return
          key = undefined
          images.clear()
          mentions.value = []
          people.value = []
          body.value = readDraft(next)
          key = next
        },
        { immediate: true, flush: "sync" },
      )
      watch(
        body,
        (text) => {
          if (key) saveDraft(key, text)
        },
        { flush: "sync" },
      )
    })
  }
  // Waiting for the picture of the area being commented on before it sends (DropViewer's submit).
  const waiting = ref(false)

  /** Empties the draft once its comment is in the outbox. */
  function clear() {
    body.value = ""
    images.clear()
  }

  return { body, images, mentions, people, rememberPeople, waiting, clear, scope }
})
