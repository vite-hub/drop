import { HTTPError } from "h3"
import { parseTar } from "nanotar"
import { MAX_APP_BYTES, MAX_APP_FILES, MIB } from "#shared/quotas"

/**
 * A built app arrives as one archive: `tar -czf - -C dist . | curl -T - '<uploadUrl>'`. This turns it into the app's
 * files, binary ones included. The largest app, plus a tar header and padding per file, is as much as an archive may
 * hold once unpacked; past that, unpacking stops, so a small archive that expands without end can't fill memory.
 */
export const MAX_ARCHIVE_BYTES = MAX_APP_BYTES + MAX_APP_FILES * 1024 + MIB

const tooLarge = () =>
  new HTTPError({
    status: 413,
    statusText: `The archive unpacks to more than ${Math.round(MAX_ARCHIVE_BYTES / MIB)} MiB, larger than any app.`,
  })

async function gunzip(bytes: Uint8Array, limit: number): Promise<Uint8Array> {
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

// What macOS and Finder leave next to real files.
const JUNK = /(^|\/)(\._[^/]*|\.DS_Store)$/

/** The files of a .tar.gz (or plain .tar), keyed by path. A lone top folder (`tar -czf - dist`) is taken off. */
export async function unpackApp(upload: Uint8Array): Promise<Record<string, Uint8Array>> {
  const gzip = upload[0] === 0x1f && upload[1] === 0x8b
  if (!gzip && upload.byteLength > MAX_ARCHIVE_BYTES) throw tooLarge()
  // nanotar reads `data.buffer` from its start, so the bytes need a buffer of their own.
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
