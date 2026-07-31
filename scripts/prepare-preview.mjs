import { readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const pullRequest = process.argv[2]
if (!/^[1-9]\d*$/.test(pullRequest ?? ""))
  throw new Error("A positive pull request number is required.")

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const sourcePath = resolve(root, ".output/server/wrangler.json")
const previewPath = resolve(root, ".output/server/wrangler.preview.json")
const config = JSON.parse(await readFile(sourcePath, "utf8"))
const productionName = config.name
const previewName = `${productionName}-pr-${pullRequest}`

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
  if (name === productionName) return previewName
  if (name.startsWith(`${productionName}-`))
    return `${previewName}-${name.slice(productionName.length + 1)}`
  return `${previewName}-${name}`
}
