import comark from "comark-linter/doctor"
import { defineDoctorConfig } from "vite-doctor/config"

export default defineDoctorConfig({
  extends: ["nuxt/strict", "typescript/strict", "vue/strict", "vite/strict", "nitro/strict", "comark/recommended"],
  extensions: [
    // The skills are the Markdown agents read and copy into drops, so they get the checks Drop runs when one publishes
    // (server/utils/markdown-document.ts lintMarkdown). content/docs is the docs site, made of Vue components a drop
    // can't use. Drop's skills endpoint adds pr-evidence's references/annotations.md and references/comark-ui/ from
    // comark-ui's own skill (server/utils/skills.ts), so links to them resolve only once served.
    comark({ include: "skills/**/*.md", links: { skip: [/^references\/(?:annotations\.md|comark-ui\/)/] } }),
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
        "Public page-tool discovery filters every tool through its allowed callback: Comments checks read permission, and other sites get 403 before any check. Denied or failed checks expose no tool. Doctor cannot follow the bundled dispatcher.",
    },
    {
      ruleId: "nuxt/middleware/no-route-middleware-api-security",
      file: ".vitehub/nitro/comments/page-session.mjs",
      reason:
        "Generated re-export of the same public page-tool discovery handler. Comments checks Console section access and read permission in its allowed callback; denied or failed checks expose no tool. Doctor cannot follow the re-export and callback.",
    },
  ],
})
