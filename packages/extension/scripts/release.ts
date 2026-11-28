import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { basename } from "node:path"
import { fileURLToPath } from "node:url"

const PACKAGE = fileURLToPath(new URL("../", import.meta.url))
const ROOT = fileURLToPath(new URL("../../../", import.meta.url))
const OUTPUT = `${PACKAGE}.output/`
const RELEASE = `${OUTPUT}release/`

const CODE = [
  "packages/extension",
  "shared",
  "app/components/DropMark.vue",
  "skills/prototype/assets/picker.js",
  "LICENSE",
]

const SOURCES = [
  ...CODE,
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".npmrc",
  ".pnpmfile.cjs",
  "patches",
  "packages/nuxt/package.json",
]

const NODE = "24"
const PNPM = "11.18.0"
const PART = /^(?:0|[1-9]\d{0,4})$/

interface FirefoxManifest {
  version: string
  browser_specific_settings?: { gecko?: { id: string; update_url?: string } }
}

function parts(version: string) {
  const list = version.split(".")
  if (!list.every((part) => PART.test(part) && Number(part) <= 65_535))
    throw new Error(`${version} isn't a browser extension version: numbers from 0 to 65535 joined by dots.`)
  return list.map(Number)
}

function release(version: string) {
  if (parts(version).length !== 3) throw new Error(`The extension's version ${version} isn't X.Y.Z.`)
  return version
}

function compare(a: string, b: string) {
  const left = parts(a)
  const right = parts(b)
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference) return Math.sign(difference)
  }
  return 0
}

export function stableVersion(tag: string, version: string) {
  release(version)
  if (tag !== `extension-v${version}`)
    throw new Error(`The tag ${tag} doesn't match packages/extension/package.json, which says ${version}.`)
  return version
}

export function betaVersion(version: string, previous = "") {
  release(version)
  if (!previous) return `${version}.1`
  const [major, minor, patch, build, ...rest] = parts(previous)
  if (build === undefined || rest.length) throw new Error(`The last beta ${previous} isn't X.Y.Z.N.`)
  const base = `${major}.${minor}.${patch}`
  if (compare(base, version) > 0) throw new Error(`The last beta ${previous} is newer than ${version}.`)
  if (base !== version) return `${version}.1`
  if (build === 65_535) throw new Error(`The beta after ${previous} needs a new X.Y.Z in package.json.`)
  return `${version}.${build + 1}`
}

export function sourcesReadme(version: string, beta: boolean) {
  const prefix = beta ? `DROP_BETA=${version} ` : ""
  return `# Drop extension ${version}: build from source

These are the files that build Drop's browser extension, from https://github.com/vite-hub/drop at the commit
of this release. The extension is in \`packages/extension\`; it also bundles files from \`shared/\`,
\`app/components/DropMark.vue\` and \`skills/prototype/assets/picker.js\`, and dependencies from npm.

Requirements: Linux or macOS, Node.js ${NODE} (24.15 or newer), and pnpm ${PNPM}.

\`\`\`sh
npm install --global pnpm@${PNPM}
pnpm install --frozen-lockfile --ignore-scripts
${prefix}pnpm --filter @vite-hub/drop-extension build:firefox
${prefix}pnpm --filter @vite-hub/drop-extension build
\`\`\`

\`packages/extension/.output/firefox-mv3\` then holds the files of the Firefox package, and
\`packages/extension/.output/chrome-mv3\` those of the Chrome package, byte for byte.
\`--ignore-scripts\` skips the website's own setup, which the extension doesn't use.
`
}

function git(...args: string[]) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim()
}

function packageVersion(): string {
  return JSON.parse(readFileSync(`${PACKAGE}package.json`, "utf8")).version
}

function zip(directory: string, file: string) {
  rmSync(file, { force: true })
  execFileSync("zip", ["-qrX", file, "."], { cwd: directory })
}

function pack(version: string, channel: "stable" | "beta") {
  const name = channel === "beta" ? "drop-beta" : "drop"
  rmSync(RELEASE, { recursive: true, force: true })
  mkdirSync(RELEASE, { recursive: true })
  zip(`${OUTPUT}chrome-mv3`, `${RELEASE}${name}-${version}-chrome.zip`)
  zip(`${OUTPUT}firefox-mv3`, `${RELEASE}${name}-${version}-firefox-unsigned.xpi`)
  git(
    "archive",
    "--format=zip",
    `--output=${RELEASE}${name}-${version}-sources.zip`,
    `--add-virtual-file=README.md:${sourcesReadme(version, channel === "beta")}`,
    "HEAD",
    "--",
    ...SOURCES,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isFirefoxManifest(value: unknown): value is FirefoxManifest {
  if (!isRecord(value) || typeof value.version !== "string") return false
  const settings = value.browser_specific_settings
  if (settings === undefined) return true
  if (!isRecord(settings)) return false
  const gecko = settings.gecko
  if (gecko === undefined) return true
  return (
    isRecord(gecko) &&
    typeof gecko.id === "string" &&
    (gecko.update_url === undefined || typeof gecko.update_url === "string")
  )
}

export function updates(manifest: unknown, xpi: string, hash: string) {
  if (!isFirefoxManifest(manifest)) throw new Error("This isn't a Firefox build's manifest.")
  const gecko = manifest.browser_specific_settings?.gecko
  if (!gecko?.update_url) throw new Error("This Firefox build has no update_url: build it with DROP_BETA.")
  return {
    addons: {
      [gecko.id]: {
        updates: [
          {
            version: manifest.version,
            update_link: new URL(xpi, gecko.update_url).href,
            update_hash: `sha256:${hash}`,
          },
        ],
      },
    },
  }
}

function writeUpdates(xpi: string) {
  const manifest: unknown = JSON.parse(readFileSync(`${OUTPUT}firefox-mv3/manifest.json`, "utf8"))
  const hash = createHash("sha256").update(readFileSync(xpi)).digest("hex")
  writeFileSync(`${RELEASE}updates.json`, `${JSON.stringify(updates(manifest, basename(xpi), hash), null, 2)}\n`)
}

function changed(since: string) {
  try {
    execFileSync("git", ["diff", "--quiet", since, "HEAD", "--", ...SOURCES], { cwd: ROOT })
    return false
  } catch {
    return true
  }
}

function notes(since = "") {
  const start =
    since ||
    `${git("log", "--diff-filter=A", "--format=%H", "--", "packages/extension/package.json").split("\n").at(-1)}^`
  const log = git("log", "--no-merges", "--format=- %s (%h)", `${start}..HEAD`, "--", ...CODE)
  return log ? `${log}\n` : "No changes to the extension.\n"
}

async function google(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`https://chromewebstore.googleapis.com/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}` },
  })
  const body = await response.json()
  if (!response.ok) throw new Error(`Chrome Web Store ${path}: ${response.status} ${JSON.stringify(body)}`)
  return body
}

async function chromeWebStore(file: string, item: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: env("CWS_CLIENT_ID"),
      client_secret: env("CWS_CLIENT_SECRET"),
      refresh_token: env("CWS_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  })
  const { access_token: token, error } = await response.json()
  if (!token) throw new Error(`Google refused the Chrome Web Store refresh token: ${error}`)
  const items = `v2/publishers/${env("CWS_PUBLISHER_ID")}/items/${item}`
  let { uploadState: state } = await google(`upload/${items}:upload`, token, {
    method: "POST",
    body: readFileSync(file),
  })
  for (let attempt = 0; state === "IN_PROGRESS" && attempt < 60; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5000))
    ;({ lastAsyncUploadState: state } = await google(`${items}:fetchStatus`, token))
  }
  if (state !== "SUCCEEDED") throw new Error(`The Chrome Web Store upload ended ${state}.`)
  const published = await google(`${items}:publish`, token, { method: "POST" })
  console.log(`Chrome Web Store: ${basename(file)} uploaded to ${item}, ${published.state ?? "submitted"} for review.`)
}

const USAGE = `Usage: node scripts/release.ts <command>
  version stable <tag>          checks the tag against package.json and prints X.Y.Z
  version beta [last beta]      prints the next X.Y.Z.N
  changed <ref>                 prints whether the extension's sources changed since ref
  notes [ref]                   prints release notes from commit subjects since ref
  pack <version> <stable|beta>  zips .output into .output/release with the sources zip
  updates <signed xpi>          writes .output/release/updates.json for that XPI
  cws <zip> <item id>           uploads to the Chrome Web Store and submits for review`

function argument(value: string | undefined) {
  if (!value) throw new Error(USAGE)
  return value
}

function env(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is missing.`)
  return value
}

async function main([command, first, second]: (string | undefined)[]) {
  if (command === "version" && first === "stable") return stableVersion(argument(second), packageVersion())
  if (command === "version" && first === "beta") return betaVersion(packageVersion(), second)
  if (command === "changed") return String(changed(argument(first)))
  if (command === "notes") return notes(first).trimEnd()
  if (command === "pack" && (second === "stable" || second === "beta")) return pack(argument(first), second)
  if (command === "updates") return writeUpdates(argument(first))
  if (command === "cws") return chromeWebStore(argument(first), argument(second))
  throw new Error(USAGE)
}

if (import.meta.main) {
  try {
    const output = await main(process.argv.slice(2))
    if (output !== undefined) console.log(output)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
