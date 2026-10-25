import { execFileSync } from "node:child_process"
import { test } from "vite-plus/test"

test("SSR consumers share request data without caching across users or suppressing refresh", () => {
  execFileSync(process.execPath, ["--experimental-vm-modules", "test/auth/ssr-fetch-runtime.mjs"], {
    cwd: new URL("../../", import.meta.url),
    stdio: "pipe",
  })
})
