import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const envFiles = [".env", ".env.local", ".env.production", ".env.production.local"]

function run(command, args, options) {
  const result = spawnSync(command, args, { ...options, stdio: "inherit" })
  if (result.error) throw result.error
  return result.status ?? 1
}

function deploy(env, secretsFile) {
  const command = JSON.parse(readFileSync(".output/nitro.json", "utf8")).commands?.deploy
  if (typeof command !== "string" || !command.trim()) throw new Error("Cloudflare build has no deploy command.")
  const args = secretsFile ? ["-c", `${command} --secrets-file "$1"`, "deploy", secretsFile] : ["-c", command]
  return run("sh", args, { cwd: ".output", env })
}

function loadEnvWithoutLogging(loadEnv) {
  const write = process.stderr.write.bind(process.stderr)
  process.stderr.write = () => true
  try {
    return loadEnv("production", process.cwd(), "")
  } finally {
    process.stderr.write = write
  }
}

async function main() {
  if (!envFiles.some((file) => existsSync(file))) return deploy(process.env)

  const { loadEnv } = await import("vite-plus")
  const env = { ...loadEnvWithoutLogging(loadEnv), ...process.env }
  const built = run("pnpm", ["build"], { env: { ...env, DROP_HOST: "cloudflare" } })
  if (built !== 0) return built

  const manifest = JSON.parse(readFileSync(".output/deployment.json", "utf8"))
  if (manifest.host !== "cloudflare") throw new Error("Expected a Cloudflare deployment manifest.")
  const secrets = Object.fromEntries(
    Object.entries(env).filter(
      ([name, value]) =>
        value &&
        name !== "CLOUDFLARE_API_TOKEN" &&
        manifest.env?.some(
          ({ names, prefix }) => names.includes(name) || (prefix && name.startsWith(prefix) && name !== prefix),
        ),
    ),
  )
  if (Object.keys(secrets).length === 0) return deploy(env)

  const dir = mkdtempSync(join(resolve(tmpdir()), "drop-cloudflare-"))
  try {
    const file = join(dir, "secrets.json")
    writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 })
    return deploy(env, file)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

process.exitCode = await main()
