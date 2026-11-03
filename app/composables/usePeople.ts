import type { CommentUser } from "vite-hub/comments/client"

/**
 * Whom "@" may name in the open drop's editor: ViteHub Comments' people who may read the drop, as the comment boxes ask
 * (server/api/drops/[id]/people.get.ts). Only signed-in people may list them, so a signed-out reader gets none, and
 * nobody's page waits on the list: it loads in the browser.
 */
export function usePeople() {
  const state = injectDrop()!
  const { data: me } = useMe()
  const id = computed(() => state.drop.data.value?.id)
  const { data } = useLazyAsyncData(
    () => keys.people(id.value ?? ""),
    (): Promise<CommentUser[]> =>
      me.value && id.value ? $fetch(`/api/drops/${id.value}/people`) : Promise.resolve([]),
    { server: false, default: () => [], watch: [() => Boolean(me.value), id] },
  )
  return { people: data }
}
