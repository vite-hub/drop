import { spawn } from "node:child_process"
import { cp, mkdtemp, readFile, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const deploymentName = process.env.DROP_DEPLOYMENT_NAME
const organization = process.env.DENO_DEPLOY_ORG
const app = process.env.DENO_DEPLOY_APP || deploymentName

if (!deploymentName || !organization) {
  console.error("DROP_DEPLOYMENT_NAME and DENO_DEPLOY_ORG are required")
  process.exit(1)
}

const nativePackages = [
  ["@img/sharp-linux-x64", "0.34.5"],
  ["@img/sharp-libvips-linux-x64", "1.2.4"],
  ["@img/sharp-linux-arm64", "0.34.5"],
  ["@img/sharp-libvips-linux-arm64", "1.2.4"],
]

function waitForExit(command, args, options = {}) {
  return new Promise((resolveExit, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", ...options })
    child.on("error", reject)
    child.on("exit", (code, signal) => resolveExit({ code, signal }))
  })
}

async function run(command, args, options = {}) {
  const { code, signal } = await waitForExit(command, args, options)
  if (code !== 0) throw new Error(`${command} exited with ${signal || `code ${code}`}`)
}

await run("pnpm", ["build"], {
  env: { ...process.env, VITEHUB_HOSTING: "deno-deploy" },
})

const stage = await mkdtemp(join(tmpdir(), `${deploymentName}-deno-`))

try {
  await cp(resolve(root, ".output"), stage, { recursive: true })

  const require = createRequire(resolve(root, "package.json"))
  const sharpRequire = createRequire(require.resolve("sharp/package.json"))

  for (const [name, expectedVersion] of nativePackages) {
    const packageJsonPath = sharpRequire.resolve(`${name}/package`)
    const metadata = JSON.parse(await readFile(packageJsonPath, "utf8"))

    if (metadata.version !== expectedVersion) {
      throw new Error(`Expected ${name}@${expectedVersion}, found ${metadata.version}`)
    }

    await cp(dirname(packageJsonPath), resolve(stage, "node_modules", ...name.split("/")), {
      recursive: true,
    })
  }

  const appLookup = await waitForExit(
    "deno",
    ["deploy", "apps", "get", "--org", organization, "--app", app, "--json", "--non-interactive"],
    { env: process.env, stdio: "ignore" },
  )

  if (appLookup.code !== 0 && appLookup.code !== 4) {
    throw new Error(`deno app lookup exited with ${appLookup.signal || `code ${appLookup.code}`}`)
  }

  const commonArgs = [
    "--org",
    organization,
    "--app",
    app,
    "--allow-node-modules",
    "--json",
    "--non-interactive",
  ]
  const deployArgs =
    appLookup.code === 0
      ? ["deploy", ".", ...commonArgs]
      : [
          "deploy",
          "create",
          ".",
          "--source",
          "local",
          "--do-not-use-detected-build-config",
          "--runtime-mode",
          "dynamic",
          "--entrypoint",
          "server/index.ts",
          "--working-directory",
          ".",
          "--region",
          process.env.DENO_DEPLOY_REGION || "global",
          ...commonArgs,
        ]

  await run("deno", deployArgs, { cwd: stage, env: process.env })
} finally {
  await rm(stage, { force: true, recursive: true })
}
