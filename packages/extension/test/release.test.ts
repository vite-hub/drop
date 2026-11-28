import { describe, expect, test } from "vite-plus/test"
import { betaVersion, sourcesReadme, stableVersion, updates } from "../scripts/release"

describe("stable", () => {
  test("a tag that names package.json's version releases it", () => {
    expect(stableVersion("extension-v0.1.0", "0.1.0")).toBe("0.1.0")
  })

  test("any other tag stops the release", () => {
    expect(() => stableVersion("extension-v0.2.0", "0.1.0")).toThrow("doesn't match")
    expect(() => stableVersion("v0.1.0", "0.1.0")).toThrow("doesn't match")
    expect(() => stableVersion("extension-v0.1.0-rc.1", "0.1.0")).toThrow("doesn't match")
  })

  test("package.json's version has three numbers a browser accepts", () => {
    expect(() => stableVersion("extension-v0.1.0-rc.1", "0.1.0-rc.1")).toThrow("isn't a browser extension version")
    expect(() => stableVersion("extension-v0.1", "0.1")).toThrow("isn't X.Y.Z")
    expect(() => stableVersion("extension-v0.01.0", "0.01.0")).toThrow("isn't a browser extension version")
    expect(() => stableVersion("extension-v0.70000.0", "0.70000.0")).toThrow("isn't a browser extension version")
  })
})

describe("beta", () => {
  test("the first beta of a version is .1", () => {
    expect(betaVersion("0.1.0")).toBe("0.1.0.1")
    expect(betaVersion("0.2.0", "0.1.0.9")).toBe("0.2.0.1")
  })

  test("each beta of the same version counts up", () => {
    expect(betaVersion("0.1.0", "0.1.0.1")).toBe("0.1.0.2")
    expect(betaVersion("0.1.0", "0.1.0.9")).toBe("0.1.0.10")
  })

  test("a beta never goes back below the last one", () => {
    expect(() => betaVersion("0.1.0", "0.1.1.3")).toThrow("newer than 0.1.0")
    expect(() => betaVersion("0.9.0", "0.10.0.1")).toThrow("newer than 0.9.0")
    expect(() => betaVersion("0.1.0", "0.1.0.65535")).toThrow("needs a new X.Y.Z")
  })

  test("the last beta has four numbers", () => {
    expect(() => betaVersion("0.1.0", "0.1.0")).toThrow("isn't X.Y.Z.N")
  })
})

describe("Firefox self-update", () => {
  const manifest = {
    version: "0.1.0.4",
    browser_specific_settings: {
      gecko: {
        id: "drop-beta@vitehub.dev",
        update_url: "https://github.com/vite-hub/drop/releases/download/extension-beta/updates.json",
      },
    },
  }

  test("updates.json points the beta's id at the signed XPI beside it", () => {
    expect(updates(manifest, "drop-beta-0.1.0.4.xpi", "ab12")).toEqual({
      addons: {
        "drop-beta@vitehub.dev": {
          updates: [
            {
              version: "0.1.0.4",
              update_link: "https://github.com/vite-hub/drop/releases/download/extension-beta/drop-beta-0.1.0.4.xpi",
              update_hash: "sha256:ab12",
            },
          ],
        },
      },
    })
  })

  test("a file that isn't a Firefox manifest has no updates.json", () => {
    expect(() => updates({ version: 1 }, "a.xpi", "ab")).toThrow("isn't a Firefox build's manifest")
    expect(() => updates({ version: "0.1.0", browser_specific_settings: { gecko: {} } }, "a.xpi", "ab")).toThrow(
      "isn't a Firefox build's manifest",
    )
  })

  test("a stable build has no updates.json", () => {
    expect(() =>
      updates({ version: "0.1.0", browser_specific_settings: { gecko: { id: "drop@vitehub.dev" } } }, "a.xpi", "ab"),
    ).toThrow("no update_url")
  })
})

test("the sources README builds the beta with its version", () => {
  expect(sourcesReadme("0.1.0.4", true)).toContain(
    "DROP_BETA=0.1.0.4 pnpm --filter @vite-hub/drop-extension build:firefox",
  )
  expect(sourcesReadme("0.1.0", false)).toContain("\npnpm --filter @vite-hub/drop-extension build:firefox")
  expect(sourcesReadme("0.1.0", false)).toContain("pnpm 11.18.0")
})
