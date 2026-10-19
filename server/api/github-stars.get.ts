import { defineCachedHandler } from "nitro/cache"
import { $fetch } from "ofetch"
import * as v from "valibot"

const Repo = v.object({ stargazers_count: v.pipe(v.number(), v.integer(), v.minValue(0)) })

// Cache failures too, so GitHub rate limits don't trigger a lookup per visitor.
export default defineCachedHandler(
  async () => {
    const repo: unknown = await $fetch("https://api.github.com/repos/vite-hub/drop", {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "vitehub-drop" },
      timeout: 3000,
      retry: 0,
    }).catch(() => null)
    const parsed = v.safeParse(Repo, repo)
    return { stars: parsed.success ? parsed.output.stargazers_count : null }
  },
  { name: "github-stars", getKey: () => "vitehub-drop", maxAge: 3600, swr: true },
)
