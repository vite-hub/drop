import { fileURLToPath } from "node:url"
import ui from "@nuxt/ui/vite"
import { defineConfig } from "wxt"
import { customizeIcon, ui as theme } from "../../shared/ui-config"

const LICENSE = fileURLToPath(new URL("../../LICENSE", import.meta.url))

export default defineConfig({
  modules: ["@wxt-dev/module-vue"],
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: "Drop",
    description: "Review any site with your Drop: comment on the page, see who else is there.",
    permissions: ["activeTab", "scripting", "storage", "identity", "contextMenus"],
    optional_host_permissions: ["<all_urls>"],
    action: {
      default_title: "Drop",
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
              id: "drop@vitehub.dev",
              strict_min_version: "128.0",
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
      ui({
        ui: theme,
        icon: { customize: customizeIcon, clientBundle: { scan: true } },
      }),
    ],
  }),
})
