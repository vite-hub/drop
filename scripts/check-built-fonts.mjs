// Fails the build when a built @font-face points at another font's file. Nuxt's parallel client and server builds once
// mixed up CSS asset references, so "Geist Variable" loaded the Geist Mono Vietnamese file and spaces rendered 8px wide.
import { readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"

const sources = [
  "@fontsource-variable/geist/index.css",
  "@fontsource-variable/geist-mono/index.css",
  "@fontsource/instrument-serif/latin-400-italic.css",
]
const dir = process.argv[2] ?? ".output/public/_drop-ui"
const require = createRequire(import.meta.url)

const faces = (css, stem) =>
  [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => {
    const family = /font-family:\s*['"]?([^;'"]+)/.exec(body)?.[1]
    const file = /url\(([^)]+)\)/.exec(body)?.[1] ?? ""
    return `${family} → ${stem(file.split("/").pop())}`
  })

const expected = sources.flatMap((source) =>
  faces(readFileSync(require.resolve(source), "utf8"), (name) => name.replace(/\.woff2?$/, "")),
)
const entries = readdirSync(dir).filter((name) => /^entry\..*\.css$/.test(name))
if (!entries.length) throw new Error(`No entry CSS in ${dir}`)
for (const entry of entries) {
  const built = faces(readFileSync(join(dir, entry), "utf8"), (name) => name.replace(/\.[\w-]+\.woff2?$/, ""))
  const wrong = expected.filter((face, i) => built[i] !== face)
  if (wrong.length) {
    console.error(
      `${entry}: font files don't match their @font-face.\nExpected:\n  ${expected.join("\n  ")}\nBuilt:\n  ${built.join("\n  ")}`,
    )
    process.exit(1)
  }
}
console.log(`Fonts check: ${expected.length} @font-face rules point at their own files.`)
