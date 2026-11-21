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
  "skills/**/scripts/**",
]

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    semi: false,
    printWidth: 120,
    ignorePatterns: [...generated, "**/*.md", "server/databases/default/migrations/**", "*.jsonc"],
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
      "no-await-in-loop": "off",
      "unicorn/no-array-sort": "off",
      "unicorn/no-array-reverse": "off",
      "oxc/no-map-spread": "off",
      "typescript/consistent-return": "off",
      "no-underscore-dangle": "off",
      "import/no-unassigned-import": ["error", { allow: ["**/*.css"] }],
      "typescript/no-unsafe-type-assertion": "off",
      "typescript/no-unnecessary-type-assertion": "off",
    },
    overrides: [
      {
        files: ["server/**", "shared/**"],
        rules: {
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
    pool: "forks",
    setupFiles: ["test/setup.ts"],
    restoreMocks: true,
  },
})
