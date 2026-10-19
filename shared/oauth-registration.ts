import * as v from "valibot"

const Metadata = v.record(v.string(), v.unknown())
const RedirectUris = v.pipe(v.array(v.unknown()), v.minLength(1), v.maxLength(5))
const LongField = v.pipe(v.string(), v.minLength(2049))
const FieldList = v.pipe(v.array(v.pipe(v.string(), v.maxLength(2048))), v.maxLength(10))
const ClientName = v.pipe(v.string(), v.maxLength(160))

/** Bound RFC 7591 metadata without restricting MCP clients' native redirect schemes. */
export function registrationProblem(body: unknown): string | null {
  if (Array.isArray(body) || !v.is(Metadata, body)) return "Client metadata must be an object."
  if (!v.is(RedirectUris, body.redirect_uris)) return "Register between one and five redirect URIs."
  if (JSON.stringify(body).length > 16_384) return "Client metadata is too large."
  for (const value of Object.values(body)) {
    if (v.is(LongField, value)) return "Client metadata fields must be at most 2048 characters."
    if (Array.isArray(value) && !v.is(FieldList, value)) return "Client metadata lists are too large."
  }
  if (v.is(v.string(), body.client_name) && !v.is(ClientName, body.client_name)) return "Client name is too long."
  return null
}
