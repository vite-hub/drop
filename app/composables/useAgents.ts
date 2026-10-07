import type { ConnectedAgent } from "#shared/types"

/** The agents this person approved over MCP, and disconnecting one. */
export function useAgents() {
  const { data: agents, status, refresh } = useApi<ConnectedAgent[]>("/api/agents", { key: "agents", default: () => [] })
  const notify = useNotify()
  const confirm = useConfirm()

  async function disconnect(agent: ConnectedAgent) {
    if (!await confirm({ title: `Disconnect ${agent.name}?`, description: "It has to ask again before it can drop for you. A token it already holds expires within the hour.", confirmLabel: "Disconnect", destructive: true })) return
    try {
      await $fetch(`/api/agents/${agent.id}`, { method: "DELETE" })
      notify.done(`${agent.name} disconnected`)
    }
    catch (error) {
      notify.fail(`Couldn't disconnect ${agent.name}`, error)
    }
    await refresh()
  }

  return { agents, status, disconnect }
}
