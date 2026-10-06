import { defineHandler } from "h3"
import type { ApiKeyRow } from "#shared/types"
import { authFor, requireIdentity } from "../../utils/identity"

export default defineHandler(async (event): Promise<ApiKeyRow[]> => {
  await requireIdentity(event)
  const result = await authFor(event).api.listApiKeys({ headers: event.req.headers })
  const keys = Array.isArray(result) ? result : (result as { apiKeys?: unknown[] }).apiKeys ?? []
  return (keys as Array<{ id: string; name: string | null; start: string | null; createdAt: Date; lastRequest: Date | null }>).map(key => ({
    id: key.id,
    name: key.name ?? "API key",
    start: key.start,
    createdAt: new Date(key.createdAt).getTime(),
    lastRequest: key.lastRequest ? new Date(key.lastRequest).getTime() : null,
  }))
})
