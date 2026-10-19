/**
 * An admin's answer to one item in a queue (a report, a member's pending shares). The queue reloads once the server
 * took it; a refusal shows as a toast. `busy` holds every button while one answer is on its way.
 */
export function useAdminAction(path: (id: string) => string, failure: string, refresh: () => Promise<unknown>) {
  const notify = useNotify()
  const busy = ref(false)
  async function run(id: string, action: string) {
    busy.value = true
    try {
      await $fetch(path(id), { method: "POST", body: { action } })
      await refresh()
    } catch (cause) {
      notify.fail(failure, cause)
    } finally {
      busy.value = false
    }
  }
  return { busy, run }
}
