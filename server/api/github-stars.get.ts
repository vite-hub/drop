import { defineCachedHandler } from "nitro/cache"
import { $fetch } from "ofetch"

// Cache failures too, so GitHub rate limits don't trigger a lookup per visitor.
export default defineCachedHandler(async () => {
  const repo = await $fetch<{ stargazers_count: number }>("https://api.github.com/repos/vite-hub/drop", {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "vitehub-drop" },
    timeout: 3000, retry: 0,
  }).catch(() => null)
  const stars = repo?.stargazers_count
  return { stars: typeof stars === "number" && Number.isInteger(stars) && stars >= 0 ? stars : null }
}, { name: "github-stars", getKey: () => "vitehub-drop", maxAge: 3600, swr: true })
