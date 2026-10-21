// Copies Slidev's own agent skill (skills/slidev in slidevjs/slidev, MIT) into skills/slidev, so Drop serves it next
// to its own skills and vitehub-drop can send deck work there. Run it to pick up upstream changes:
//   node scripts/sync-slidev-skill.mjs [ref]
// It writes SKILL.md, references/ and Slidev's MIT LICENSE (which the copy must keep), deletes files upstream dropped,
// and prints the commit to note in the README.
import { mkdir, readdir, rm, writeFile } from "node:fs/promises"

const repo = "slidevjs/slidev"
const ref = process.argv[2] ?? "main"
const target = new URL("../skills/slidev/", import.meta.url)

const api = async (path) => {
  const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "drop-skill-sync" },
  })
  if (!response.ok) throw new Error(`GitHub ${path}: ${response.status}`)
  return response.json()
}

const { sha } = await api(`commits/${ref}`)
const { tree } = await api(`git/trees/${sha}?recursive=1`)
// The skill itself: SKILL.md and its references. README.md is for people browsing the repo.
const paths = tree
  .filter((entry) => entry.type === "blob" && /^skills\/slidev\/(SKILL\.md|references\/[\w.-]+\.md)$/.test(entry.path))
  .map((entry) => entry.path.slice("skills/slidev/".length))
if (!paths.includes("SKILL.md")) throw new Error(`No skills/slidev/SKILL.md at ${sha}`)

await rm(target, { recursive: true, force: true })
await mkdir(new URL("references/", target), { recursive: true })
for (const path of paths) {
  const response = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/skills/slidev/${path}`)
  if (!response.ok) throw new Error(`${path}: ${response.status}`)
  await writeFile(new URL(path, target), await response.text())
}
const license = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/LICENSE`)
if (!license.ok) throw new Error(`LICENSE: ${license.status}`)
await writeFile(new URL("LICENSE", target), await license.text())
const references = await readdir(new URL("references/", target))
console.log(`skills/slidev: SKILL.md and ${references.length} references from ${repo}@${sha}`)
