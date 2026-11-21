import type { CommentUser } from "vite-hub/comments/client"
import { createRestTransport } from "vite-hub/comments/client"

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
