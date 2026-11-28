import { fileURLToPath } from "node:url"
import ui from "@nuxt/ui/vite"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite-plus"
import { customizeIcon, ui as theme } from "../../shared/ui-config"

export default defineConfig({
  test: {
    setupFiles: ["test/setup.ts"],
    projects: [
      { extends: true, test: { name: "lib", include: ["test/*.test.ts"] } },
      {
        extends: true,
        plugins: [vue(), ui({ ui: theme, icon: { customize: customizeIcon, clientBundle: { scan: true } } })],
        resolve: {
          alias: [
            {
              find: /^@iconify\/vue$/,
              replacement: fileURLToPath(new URL("./assets/iconify-offline.ts", import.meta.url)),
            },
          ],
        },
        test: { name: "pages", include: ["test/pages/*.test.ts"], environment: "happy-dom" },
      },
    ],
  },
})
