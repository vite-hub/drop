import { promiseTimeout } from "@vueuse/core"
import type { CommentUser } from "vite-hub/comments/client"

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
  } catch {}
}

export const [provideReviewDraft, injectReviewDraft] = createInjectionState((drop?: () => string) => {
  const body = ref("")
  const images = useImagePicks()
  const mentions = ref<string[]>([])
  const people = ref<CommentUser[]>([])
  const session = drop ? useMe() : undefined
  const scope = computed(() => JSON.stringify([session?.data.value?.id ?? null, drop?.()]))
  async function rememberPeople(found: CommentUser[]) {
    const owner = scope.value
    await promiseTimeout(0)
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
  function clear() {
    body.value = ""
    images.clear()
  }

  return { body, images, mentions, people, rememberPeople, clear, scope }
})
