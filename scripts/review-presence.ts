import { fileURLToPath } from "node:url"
import { build, type Plugin } from "vite-plus"

const ID = "virtual:review-presence"
const ENTRY = fileURLToPath(new URL("./review-presence-entry.ts", import.meta.url))

export function reviewPresence(): Plugin {
  let code: Promise<string> | undefined
  return {
    name: "drop:review-presence",
    resolveId: (source) => (source === ID ? `\0${ID}` : undefined),
    load(id) {
      if (id !== `\0${ID}`) return
      code ??= bundle()
      return code.then((text) => `export default ${JSON.stringify(text)}`)
    },
  }
}

async function bundle() {
  const result = await build({
    configFile: false,
    envDir: false,
    logLevel: "warn",
    build: {
      write: false,
      minify: true,
      target: "es2022",
      lib: { entry: ENTRY, formats: ["es"], fileName: "review-presence" },
    },
  })
  const output = Array.isArray(result) ? result[0] : result
  if (!output || !("output" in output)) throw new Error("The presence client for review.js didn't build.")
  return output.output[0].code
}
