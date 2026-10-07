import type { ApiKeyRow } from "#shared/types"
import type { ApiKeyInput } from "#shared/schemas"

/** Your API keys. A new key's secret is returned once, by `create`, and never stored here. */
export function useApiKeys() {
  const { data: keys, status, refresh } = useApi<ApiKeyRow[]>("/api/keys", { key: "keys", default: () => [] })
  const notify = useNotify()
  const confirm = useConfirm()

  return {
    keys,
    status,
    async create(input: ApiKeyInput) {
      const created = await $fetch<{ id: string; key: string; name: string }>("/api/keys", { method: "POST", body: input })
      await refresh()
      return created
    },
    async revoke(key: ApiKeyRow) {
      if (!await confirm({ title: `Revoke “${key.name}”?`, description: "Anything using it gets a 401 on its next request.", confirmLabel: "Revoke", destructive: true })) return
      try {
        await $fetch(`/api/keys/${key.id}`, { method: "DELETE" })
        keys.value = keys.value.filter(item => item.id !== key.id)
        notify.done(`Revoked “${key.name}”`, "Anything using it gets a 401 on its next request.")
      }
      catch (error) {
        notify.fail("Couldn't revoke the key", error)
      }
    },
  }
}
