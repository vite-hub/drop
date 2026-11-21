import comark from "comark-linter/doctor"
import { defineDoctorConfig } from "vite-doctor/config"
import vitehub from "vite-hub/doctor"

export default defineDoctorConfig({
  extends: [
    "nuxt/strict",
    "typescript/strict",
    "vue/strict",
    "vite/strict",
    "nitro/strict",
    "comark/recommended",
    "vitehub/recommended",
  ],
  extensions: [
    vitehub,
    // The skills are the Markdown agents read and copy into drops, so they get the checks Drop runs when one publishes
    // (server/utils/markdown-document.ts lintMarkdown). content/docs is the docs site, made of Vue components a drop
    // can't use. Drop's skills endpoint adds pr-evidence's references/annotations.md and references/comark-ui/ from
    // comark-ui's own skill (server/utils/skills.ts), so links to them resolve only once served. code-along's example is
    // a lesson whose links point at the files inside it, which the lesson's page opens.
    comark({
      include: "skills/**/*.md",
      exclude: ["**/node_modules/**", "skills/code-along/references/example.md"],
      links: { skip: [/^references\/(?:annotations\.md|comark-ui\/)/] },
    }),
  ],
  rules: {
    "typescript/strict/no-comments": ["error", { apiDocs: "none" }],
    "vueuse/prefer-use-timers": "error",
    "nuxt/imports/prefer-alias-over-relative-parent": "off",
    "nitro/h3/prefer-nitro-h3": "off",
    "typescript/boundaries/no-inherited-key-lookup": "off",
    "typescript/boundaries/no-cross-realm-builtin-instanceof": "off",
    "vue/ssr/data-allow-mismatch-surgical": "off",
  },
  overrides: [
    {
      files: ["skills/**"],
      rules: { "typescript/strict/no-comments": "off", "vueuse/prefer-use-timers": "off" },
    },
  ],
  suppressions: [
    {
      ruleId: "nuxt/imports/no-explicit-auto-import",
      file: "app/components/viewer/ViewerCommentField.vue",
      reason:
        "Keep the mention helpers explicit alongside the Person type in this mixed import. Nuxt supports the explicit import; the redundant-import warning is stylistic.",
    },
    {
      ruleId: "nuxt/middleware/no-route-middleware-api-security",
      file: "node_modules/*/vite-hub/dist/console/runtime/server/page-session.js",
      reason:
        "Public page-tool discovery filters every tool through its allowed callback: Console uses consoleAllowsRequest, and Comments checks Console access and read permission. Denied or failed checks expose no tool. Doctor cannot follow the bundled dispatcher.",
    },
    {
      ruleId: "nuxt/middleware/no-route-middleware-api-security",
      file: ".vitehub/nitro/comments/page-session.mjs",
      reason:
        "Generated re-export of the same public page-tool discovery handler. Comments checks Console section access and read permission in its allowed callback; denied or failed checks expose no tool. Doctor cannot follow the re-export and callback.",
    },
  ],
})
