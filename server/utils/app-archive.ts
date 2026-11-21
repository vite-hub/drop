import { HTTPError } from "h3"
import { parseTar } from "nanotar"
import { MAX_APP_BYTES, MAX_APP_FILES, MIB } from "#shared/quotas"

export const MAX_ARCHIVE_BYTES = MAX_APP_BYTES + MAX_APP_FILES * 1024 + MIB

const tooLarge = () =>
  new HTTPError({
    status: 413,
    statusText: `The archive unpacks to more than ${Math.round(MAX_ARCHIVE_BYTES / MIB)} MiB, larger than any app.`,
  })

async function gunzip(bytes: Uint8Array, limit: number): Promise<Uint8Array> {
  // SAFETY: Drop's bytes come from request bodies and blob reads, which are ArrayBuffer-backed, never shared memory.
  const reader = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"))
    .getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) {
        await reader.cancel()
        throw tooLarge()
      }
      chunks.push(value)
    }
  } catch (error) {
    if (HTTPError.isError(error)) throw error
    throw new HTTPError({ status: 400, statusText: "The archive isn't valid gzip. Send a .tar.gz, as tar -czf makes." })
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.byteLength
  }
  return out
}

const JUNK = /(^|\/)(\._[^/]*|\.DS_Store)$/

export async function unpackApp(upload: Uint8Array): Promise<Record<string, Uint8Array>> {
  const gzip = upload[0] === 0x1f && upload[1] === 0x8b
  if (!gzip && upload.byteLength > MAX_ARCHIVE_BYTES) throw tooLarge()
  const tar = gzip ? await gunzip(upload, MAX_ARCHIVE_BYTES) : upload.slice()
  let entries
  try {
    entries = parseTar(tar)
  } catch {
    throw new HTTPError({ status: 400, statusText: "The archive isn't a valid tar file." })
  }
  const files = new Map<string, Uint8Array>()
  for (const entry of entries) {
    if (entry.type !== "file" && entry.type !== "contiguousFile") continue
    const path = entry.name.replace(/^(\.\/)+/, "")
    if (!path || JUNK.test(path)) continue
    files.set(path, entry.data ?? new Uint8Array())
  }
  if (!files.size)
    throw new HTTPError({
      status: 400,
      statusText: "The archive holds no files. Pack the built folder's contents: tar -czf - -C dist .",
    })
  const paths = [...files.keys()]
  const top = paths[0]!.split("/")[0]!
  if (!files.has("index.html") && paths.every((path) => path.startsWith(`${top}/`)) && files.has(`${top}/index.html`))
    return Object.fromEntries(paths.map((path) => [path.slice(top.length + 1), files.get(path)!]))
  return Object.fromEntries(files)
}
