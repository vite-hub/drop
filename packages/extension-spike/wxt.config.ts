import { fileURLToPath } from "node:url"
import ui from "@nuxt/ui/vite"
import { defineConfig } from "wxt"

// Spike only. See SPIKE.md for what each piece proves.
export default defineConfig({
  modules: ["@wxt-dev/module-vue"],
  // WXT builds Firefox as MV2 by default; the spike targets MV3 in both browsers.
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: "Drop spike",
    description: "Platform spike for the Drop browser extension.",
    permissions: ["activeTab", "scripting", "storage", "identity", "contextMenus"],
    optional_host_permissions: ["<all_urls>"],
    // Firefox's default MV3 extension CSP adds upgrade-insecure-requests, which turns the spike's ws:// socket into
    // wss:// (close code 1015). Production Drop uses wss, so this only matters for the local test server.
    content_security_policy: { extension_pages: "script-src 'self'" },
    // Firefox MV3 hides actions in the extensions menu by default; navbar keeps the button clickable in e2e.
    action: { default_title: "Drop spike", ...(browser === "firefox" ? { default_area: "navbar" } : {}) },
    commands: {
      "review-page": {
        suggested_key: { default: "Alt+Shift+Y" },
        description: "Review this page with Drop",
      },
    },
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: { id: "drop-spike@example.com", strict_min_version: "128.0" },
          },
        }
      : {}),
  }),
  vite: () => ({
    resolve: {
      // Exact match only, so the shim's own `@iconify/vue/offline` import still resolves to the package.
      alias: [{ find: /^@iconify\/vue$/, replacement: fileURLToPath(new URL("./assets/iconify-offline.ts", import.meta.url)) }],
    },
    plugins: [
      // Nuxt UI's Vite plugin already includes @tailwindcss/vite, unplugin-auto-import and unplugin-vue-components.
      // Adding any of them again makes Nuxt UI throw a duplicate-plugin error.
      ui({
        ui: { colors: { primary: "neutral", neutral: "neutral" } },
        // Bundle every icon the source names (i-mingcute-*) into the build, so <UIcon> never fetches.
        icon: { clientBundle: { scan: true } },
      }),
    ],
  }),
})
