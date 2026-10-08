import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

/** Convert a Wrangler KV key listing into a bulk-delete input for the old, non-expiring renders. */
export function oldMarkdownCacheKeys(listing) {
  return listing.map(key => key.name).filter(name => name.startsWith("nitro-cache:nitro:functions:markdown:") && name.endsWith(".json"))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.stdout.write(JSON.stringify(oldMarkdownCacheKeys(JSON.parse(readFileSync(process.argv[2], "utf8")))) + "\n")
