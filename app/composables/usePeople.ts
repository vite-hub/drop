import type { Person } from "~/utils/mentions"

/**
 * Everyone in this Drop, for "@" in the doc editor and the comment boxes. Only signed-in people may list them, so a
 * signed-out reader gets none, and nobody's page waits on the list: it loads in the browser.
 */
export function usePeople() {
  const { data: me } = useMe()
  const signedIn = computed(() => Boolean(me.value))
  const { data } = useLazyAsyncData(
    keys.people,
    (): Promise<Person[]> => (signedIn.value ? $fetch("/api/people") : Promise.resolve([])),
    { server: false, default: () => [], watch: [signedIn] },
  )
  return { people: data, me: computed(() => me.value?.id) }
}
