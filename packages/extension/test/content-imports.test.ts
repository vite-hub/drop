import { existsSync, readFileSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vite-plus/test"

const PACKAGE = fileURLToPath(new URL("..", import.meta.url))
const ENTRY = resolve(PACKAGE, "entrypoints/review.content.ts")
const FORBIDDEN = ["lib/storage.ts", "lib/oauth.ts"]
const IMPORT = /^\s*(?:import|export)\s+(type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/gm

function file(from: string, specifier: string) {
  const base = resolve(dirname(from), specifier)
  return [base, `${base}.ts`, resolve(base, "index.ts")].find(
    (candidate) => existsSync(candidate) && candidate.endsWith(".ts"),
  )
}

function reachable(entry: string) {
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length) {
    const current = queue.pop()!
    if (seen.has(current)) continue
    seen.add(current)
    for (const [, typeOnly, specifier] of readFileSync(current, "utf8").matchAll(IMPORT)) {
      if (typeOnly || !specifier!.startsWith(".")) continue
      const next = file(current, specifier!)
      if (next) queue.push(next)
    }
  }
  return [...seen].map((path) => relative(PACKAGE, path))
}

describe("the content script", () => {
  test("can't reach the token store or the OAuth code", () => {
    const files = reachable(ENTRY)
    expect(files).toContain("lib/messages.ts")
    for (const forbidden of FORBIDDEN) expect(files).not.toContain(forbidden)
  })
})
