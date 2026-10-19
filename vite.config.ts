// Vite+ config for the toolchain only: `vp lint`, `vp fmt`, `vp test`, and the pre-commit hook. Nuxt builds the app
// from nuxt.config.ts and doesn't read this file.
import { defineConfig } from "vite-plus"
import { dropTestStubs } from "./test/stubs.ts"

const generated = [
  ".nuxt/**",
  ".output/**",
  ".vitehub/**",
  "app/.vitehub/**",
  "dist/**",
  ".wrangler/**",
  ".data/**",
  "patches/**",
  "public/vendor/**",
  "skills/**/assets/**",
]

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    semi: false,
    printWidth: 120,
    // Docs, skills, and drops are Comark, which oxfmt reads as plain Markdown and breaks. Drizzle writes migrations.
    // The build copies wrangler.jsonc into JSON that must parse strictly, so it keeps no trailing commas.
    ignorePatterns: [...generated, "**/*.md", "server/databases/migrations/**", "*.jsonc"],
  },
  lint: {
    plugins: ["eslint", "typescript", "unicorn", "oxc", "vue", "import", "promise", "node"],
    categories: {
      correctness: "error",
      suspicious: "error",
      perf: "error",
    },
    options: {
      typeAware: true,
      denyWarnings: true,
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      "typescript/consistent-type-imports": "error",
      // D1 calls run one after another on purpose: a batch would change error and rollback behaviour.
      "no-await-in-loop": "off",
      // Sorting arrays the function just built; toSorted() would only copy them.
      "unicorn/no-array-sort": "off",
      "unicorn/no-array-reverse": "off",
      "oxc/no-map-spread": "off",
      // TypeScript's return types already say what a function returns.
      "typescript/consistent-return": "off",
      // `__drop` (frame messages) and `_meta` (MCP) are protocol fields.
      "no-underscore-dangle": "off",
      "import/no-unassigned-import": ["error", { allow: ["**/*.css"] }],
      // Doctor's typescript/strict/require-safety-comment-for-type-assertion owns casts (doctor.config.json).
      "typescript/no-unsafe-type-assertion": "off",
      // tsgolint doesn't read Nuxt's generated tsconfigs (the root one only references them): it misses
      // noUncheckedIndexedAccess and the packages Nuxt maps through paths (h3, hookable). So `!` on an index and casts on
      // h3 values look unnecessary, and --fix would remove ones vue-tsc needs.
      "typescript/no-unnecessary-type-assertion": "off",
    },
    overrides: [
      {
        files: ["server/**", "shared/**"],
        rules: {
          // Same cause: a union with H3Event looks redundant because H3Event doesn't resolve.
          "typescript/no-redundant-type-constituents": "off",
        },
      },
      {
        files: ["test/**"],
        rules: {
          "typescript/require-array-sort-compare": "off",
          "typescript/restrict-template-expressions": "off",
          "typescript/no-implied-eval": "off",
          "no-shadow": "off",
          "unicorn/consistent-function-scoping": "off",
          "unicorn/no-invalid-fetch-options": "off",
          "typescript/no-base-to-string": "off",
        },
      },
    ],
    ignorePatterns: generated,
  },
  plugins: [dropTestStubs()],
  test: {
    include: ["test/**/*.test.mjs"],
    // Each file runs in its own process, with its own in-memory database.
    pool: "forks",
    setupFiles: ["test/setup.ts"],
    restoreMocks: true,
  },
})
