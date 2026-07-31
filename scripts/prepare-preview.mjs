import { readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const branch = process.argv[2]
if (!branch)
  throw new Error("A branch name is required.")

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const sourcePath = resolve(root, ".output/server/wrangler.json")
const previewPath = resolve(root, ".output/server/wrangler.preview.json")
const config = JSON.parse(await readFile(sourcePath, "utf8"))
const productionName = config.name
const previewName = `${productionName}-${branchSuffix(branch)}`
const previewResourcePrefix = `${productionName}-preview`

config.name = previewName
config.workers_dev = true
config.preview_urls = false

for (const bucket of config.r2_buckets ?? [])
  bucket.bucket_name = previewResourceName(bucket.bucket_name)

for (const queue of [
  ...(config.queues?.consumers ?? []),
  ...(config.queues?.producers ?? []),
]) {
  queue.queue = previewResourceName(queue.queue)
}

for (const rateLimit of config.ratelimits ?? [])
  rateLimit.namespace_id = hashNamespace(`${previewName}:${rateLimit.name}`)

await writeFile(previewPath, `${JSON.stringify(config, null, 2)}\n`)

console.log(JSON.stringify({
  buckets: (config.r2_buckets ?? []).map(bucket => bucket.bucket_name),
  config: previewPath,
  queues: [...new Set([
    ...(config.queues?.consumers ?? []).map(queue => queue.queue),
    ...(config.queues?.producers ?? []).map(queue => queue.queue),
  ])],
  worker: previewName,
}))

function hashNamespace(value) {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.codePointAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return String(hash >>> 0 || 1)
}

function previewResourceName(name) {
  let previewResource
  if (name === productionName) previewResource = previewResourcePrefix
  if (name.startsWith(`${productionName}-`))
    previewResource = `${previewResourcePrefix}-${name.slice(productionName.length + 1)}`
  previewResource ??= `${previewResourcePrefix}-${name}`

  if (previewResource.length < 63) return previewResource
  const hash = Number(hashNamespace(previewResource)).toString(36)
  return `${previewResource.slice(0, 62 - hash.length - 1)}-${hash}`
}

function branchSuffix(value) {
  const normalized = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
  if (!normalized)
    throw new Error("The branch name must contain a letter or number.")

  const maxLength = 63 - productionName.length - 1
  if (normalized.length <= maxLength) return normalized

  const hash = Number(hashNamespace(value)).toString(36)
  return `${normalized.slice(0, maxLength - hash.length - 1)}-${hash}`
}
