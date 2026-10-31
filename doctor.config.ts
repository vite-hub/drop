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
      ruleId: "nuxt/middleware/no-route-middleware-api-security",
      file: "node_modules/*/vite-hub/dist/console/runtime/server/auth-manage.js",
      reason:
        "ViteHub wraps this dependency handler in withConsoleAccess with section auth and user required. Doctor cannot follow that wrapper. test/auth/console-runtime.mjs verifies signed-out and non-admin requests are denied by the built Worker.",
    },
  ],
})
