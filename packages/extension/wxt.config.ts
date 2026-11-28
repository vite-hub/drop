import { fileURLToPath } from "node:url"
import ui from "@nuxt/ui/vite"
import { runnerImport, type Plugin } from "vite-plus"
import { defineConfig } from "wxt"
import type { reviewScript } from "../../shared/review-script"
import { customizeIcon, ui as theme } from "../../shared/ui-config"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const LICENSE = fileURLToPath(new URL("../../LICENSE", import.meta.url))
const REVIEW_SCRIPT = fileURLToPath(new URL("../../shared/review-script.ts", import.meta.url))
const REVIEW_MODULE = "virtual:drop-review"
const CLOSED_SHADOW = 'host.attachShadow({ mode: "closed" })'
const E2E = process.env.DROP_E2E === "1"
const BETA = process.env.DROP_BETA
const BETA_RELEASE = "https://github.com/vite-hub/drop/releases/download/extension-beta/"
const NAME = BETA ? "Drop Beta" : "Drop"

function dropReview(): Plugin {
  const resolved = `\0${REVIEW_MODULE}`
  return {
    name: "drop-review",
    resolveId: (source) => (source === REVIEW_MODULE ? resolved : undefined),
    async load(id) {
      if (id !== resolved) return undefined
      const { module, dependencies } = await runnerImport<{ reviewScript: typeof reviewScript }>(REVIEW_SCRIPT, {
        configFile: false,
        root: ROOT,
        logLevel: "error",
      })
      for (const file of dependencies) this.addWatchFile(file)
      const script = module.reviewScript({ host: "extension" })
      if (E2E && !script.includes(CLOSED_SHADOW))
        throw new Error("The review script no longer attaches its shadow root.")
      const body = E2E ? script.replace(CLOSED_SHADOW, 'host.attachShadow({ mode: "open" })') : script
      return `export default function mountReview() {\n${body}\n}\n`
    },
  }
}

export default defineConfig({
  modules: ["@wxt-dev/module-vue"],
  ...(E2E ? { outDir: ".output-e2e" } : {}),
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: NAME,
    ...(BETA ? { version: BETA } : {}),
    description: "Review any site with your Drop: comment on the page, see who else is there.",
    permissions: ["activeTab", "scripting", "storage", "identity", "contextMenus"],
    optional_host_permissions: ["<all_urls>"],
    ...(E2E ? { host_permissions: ["<all_urls>"] } : {}),
    ...(E2E && browser === "firefox" ? { content_security_policy: { extension_pages: "script-src 'self'" } } : {}),
    action: {
      default_title: NAME,
      default_popup: "popup.html",
      ...(browser === "firefox" ? { default_area: "navbar" } : {}),
    },
    commands: {
      "toggle-pill": {
        suggested_key: { default: "Alt+Shift+D" },
        description: "Show or hide Drop on this page",
      },
    },
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              id: BETA ? "drop-beta@vitehub.dev" : "drop@vitehub.dev",
              strict_min_version: "128.0",
              ...(BETA ? { update_url: `${BETA_RELEASE}updates.json` } : {}),
              data_collection_permissions: { required: ["browsingActivity", "websiteContent"] },
            },
          },
        }
      : {}),
  }),
  hooks: {
    "build:publicAssets": (_wxt, files) => {
      files.push({ absoluteSrc: LICENSE, relativeDest: "LICENSE" })
    },
  },
  vite: () => ({
    resolve: {
      alias: [
        {
          find: /^@iconify\/vue$/,
          replacement: fileURLToPath(new URL("./assets/iconify-offline.ts", import.meta.url)),
        },
      ],
    },
    plugins: [
      dropReview(),
      ui({
        ui: theme,
        icon: { customize: customizeIcon, clientBundle: { scan: true } },
      }),
    ],
  }),
})
