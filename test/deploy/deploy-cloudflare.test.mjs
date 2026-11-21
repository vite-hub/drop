import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "vite-plus/test"

const script = fileURLToPath(new URL("../../scripts/deploy-cloudflare.mjs", import.meta.url))

function project(context, files = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "drop-deploy-")))
  context.onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  const bin = join(dir, "bin")
  mkdirSync(bin)
  mkdirSync(join(dir, ".output"))
  writeFileSync(
    join(bin, "pnpm"),
    '#!/bin/sh\n[ "$1" = build ] && [ "$VITEHUB_HOST" = cloudflare ] || exit 1\necho build >> steps\n',
    {
      mode: 0o755,
    },
  )
  writeFileSync(
    join(bin, "npx"),
    `#!/bin/sh
set -eu
[ "$1" = wrangler ] && [ -f server/wrangler.json ] || exit 1
case "$2" in
  d1) echo migrate >> ../steps; exit "\${MIGRATE_STATUS:-0}" ;;
  deploy) echo deploy >> ../steps
    if [ "\${5:-}" = --secrets-file ]; then
      cp "$6" ../uploaded.json
      printf '%s' "$6" > ../secret-path
    fi ;;
  *) exit 1 ;;
esac
`,
    { mode: 0o755 },
  )
  mkdirSync(join(dir, ".output/server"))
  writeFileSync(join(dir, ".output/server/wrangler.json"), "{}")
  writeFileSync(
    join(dir, ".output/nitro.json"),
    JSON.stringify({
      commands: {
        deploy:
          "npx wrangler d1 migrations apply DB --remote --config ./server/wrangler.json && npx wrangler deploy --config ./server/wrangler.json",
      },
    }),
  )
  writeFileSync(
    join(dir, ".output/deployment.json"),
    JSON.stringify({
      host: "cloudflare",
      env: [
        { names: ["DROP_TEST_RUNTIME"], required: true },
        { names: ["DROP_TEST_EMPTY"] },
        { names: ["DROP_TEST_TOKEN"], required: true },
        { names: [], prefix: "VITEHUB_CONSOLE_KEY_", required: true, hasDefault: false },
      ],
    }),
  )
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  const read = (name) => readFileSync(join(dir, name), "utf8")
  const run = (env = {}) => {
    const log = openSync(join(dir, "deploy.log"), "w")
    try {
      const result = spawnSync(process.execPath, [script], {
        cwd: dir,
        stdio: ["ignore", log, log],
        env: { PATH: `${bin}${delimiter}${process.env.PATH}`, TMPDIR: tmpdir(), ...env },
      })
      if (result.error) throw result.error
      return { status: result.status, log: read("deploy.log") }
    } finally {
      closeSync(log)
    }
  }
  return { dir, run, read }
}

test("a first terminal deploy without Console uploads only nonempty declared values", (context) => {
  const { run, read } = project(context, {
    ".env": "DROP_TEST_RUNTIME=base\nDROP_TEST_EMPTY=\nUNDECLARED=private\n",
    ".env.production.local": 'DROP_TEST_RUNTIME="line 1\\nline 2"\n',
  })
  const result = run({ CLOUDFLARE_API_TOKEN: "host-only", DROP_TEST_TOKEN: "runtime-token" })
  assert.equal(result.status, 0, result.log)
  assert.equal(read("steps"), "build\nmigrate\ndeploy\n")
  assert.deepEqual(JSON.parse(read("uploaded.json")), {
    DROP_TEST_RUNTIME: "line 1\nline 2",
    DROP_TEST_TOKEN: "runtime-token",
  })
  assert.equal(existsSync(read("secret-path")), false)
})

test("prefix entries allow only nonempty suffixes", (context) => {
  const { run, read } = project(context, {
    ".env.local": "VITEHUB_CONSOLE_KEY_=not-a-key\nVITEHUB_CONSOLE_KEY_TEST=key\n",
  })
  const result = run()
  assert.equal(result.status, 0, result.log)
  assert.deepEqual(JSON.parse(read("uploaded.json")), { VITEHUB_CONSOLE_KEY_TEST: "key" })
})

test("Vite env debug logging does not expose deploy credentials or runtime secrets", (context) => {
  const hostToken = "fixture-cloudflare-token"
  const runtimeSecret = "fixture-github-secret"
  const { run, read } = project(context, {
    ".env.production": `GITHUB_CLIENT_SECRET=${runtimeSecret}\n`,
    ".output/deployment.json": JSON.stringify({ host: "cloudflare", env: [{ names: ["GITHUB_CLIENT_SECRET"] }] }),
  })
  const result = run({ DEBUG: "vite:env", CLOUDFLARE_API_TOKEN: hostToken })
  assert.equal(result.status, 0)
  assert.equal(result.log.includes(hostToken), false, "deploy token must not appear in logs")
  assert.equal(result.log.includes(runtimeSecret), false, "runtime secret must not appear in logs")
  assert.deepEqual(JSON.parse(read("uploaded.json")), { GITHUB_CLIENT_SECRET: runtimeSecret })
})

test("without a local env file the generated command deploys without uploading secrets", (context) => {
  const { dir, run, read } = project(context)
  const result = run({ DROP_TEST_RUNTIME: "shell-only" })
  assert.equal(result.status, 0, result.log)
  assert.equal(read("steps"), "migrate\ndeploy\n")
  assert.equal(existsSync(join(dir, "uploaded.json")), false)
})

test("a failed migration prevents deployment", (context) => {
  const { run, read } = project(context, { ".env": "DROP_TEST_RUNTIME=secret\n" })
  const result = run({ MIGRATE_STATUS: "42" })
  assert.equal(result.status, 42, result.log)
  assert.equal(read("steps"), "build\nmigrate\n")
})
