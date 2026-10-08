/** Bound RFC 7591 metadata without restricting MCP clients' native redirect schemes. */
export function registrationProblem(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Client metadata must be an object."
  const metadata = body as Record<string, unknown>
  if (!Array.isArray(metadata.redirect_uris) || metadata.redirect_uris.length < 1 || metadata.redirect_uris.length > 5)
    return "Register between one and five redirect URIs."
  if (JSON.stringify(metadata).length > 16_384) return "Client metadata is too large."
  for (const value of Object.values(metadata)) {
    if (typeof value === "string" && value.length > 2048) return "Client metadata fields must be at most 2048 characters."
    if (Array.isArray(value) && (value.length > 10 || value.some(item => typeof item !== "string" || item.length > 2048)))
      return "Client metadata lists are too large."
  }
  if (typeof metadata.client_name === "string" && metadata.client_name.length > 160) return "Client name is too long."
  return null
}
