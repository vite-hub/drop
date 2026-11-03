import type { CommentUser } from "vite-hub/comments/client"
import { createRestTransport } from "vite-hub/comments/client"

/**
 * Whom "@" may name in the open drop's editor: the people ViteHub Comments suggests for the drop's comments
 * (server/comments.ts `people` and `canMention`), as the comment boxes ask. Only signed-in people may list them, so a
 * signed-out reader gets none, and nobody's page waits on the list: it loads in the browser.
 */
export function usePeople() {
  const state = injectDrop()!
  const { data: me } = useMe()
  const subject = computed(() => commentSubject(state.drop.data.value))
  const { data } = useLazyAsyncData(
    () => keys.people(subject.value.id),
    (): Promise<CommentUser[]> =>
      me.value && subject.value.id
        ? createRestTransport().users({ query: "", limit: 20, subject: subject.value })
        : Promise.resolve([]),
    { server: false, default: () => [], watch: [() => Boolean(me.value), subject] },
  )
  return { people: data }
}
