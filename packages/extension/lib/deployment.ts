import { local } from "./storage"

const DEFAULT_DROP = "https://drop.vitehub.dev"

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"])

export type DropCheck =
  | { ok: true; drop: string; name: string; version: string; content?: string }
  | { ok: false; error: "invalid-address" | "unreachable" | "not-a-drop" | "server-error"; status?: number }

export function normalizeDrop(input: string): string | undefined {
  const text = input.trim()
  if (!text) return undefined
  let url: URL
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return undefined
  }
  if (url.username || url.password) return undefined
  if (url.protocol === "https:") return url.origin
  if (url.protocol === "http:" && LOOPBACK.has(url.hostname)) return url.origin
  return undefined
}

export function originPattern(origin: string) {
  const { protocol, hostname } = new URL(origin)
  return `${protocol}//${hostname}/*`
}

export function matchesContentOrigin(origin: string, pattern: string | undefined) {
  if (!pattern) return false
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\/]/g, "\\$&"))
    .join("[^./:]+")
  return new RegExp(`^${source}$`).test(origin)
}

export async function currentDrop() {
  return (await local.get("drop")) ?? DEFAULT_DROP
}

export async function checkDrop(input: string, fetcher: typeof fetch = fetch): Promise<DropCheck> {
  const drop = normalizeDrop(input)
  if (!drop) return { ok: false, error: "invalid-address" }
  let response: Response
  try {
    response = await fetcher(`${drop}/api/review/notes/hello`, { headers: { accept: "application/json" } })
  } catch {
    return { ok: false, error: "unreachable" }
  }
  if (response.status >= 500) return { ok: false, error: "server-error", status: response.status }
  if (!response.ok) return { ok: false, error: "not-a-drop", status: response.status }
  const hello: unknown = await response.json().catch(() => undefined)
  if (!isHello(hello)) return { ok: false, error: "not-a-drop" }
  return {
    ok: true,
    drop,
    name: hello.name,
    version: hello.version,
    ...(typeof hello.content === "string" ? { content: hello.content } : {}),
  }
}

function isHello(value: unknown): value is { drop: string; name: string; version: string; content?: unknown } {
  if (!value || typeof value !== "object") return false
  return (
    "drop" in value &&
    typeof value.drop === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "version" in value &&
    typeof value.version === "string"
  )
}
