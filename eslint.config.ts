import antfu from "@antfu/eslint-config"
import withNuxt from "./.nuxt/eslint.config.mjs"

export default withNuxt(
  antfu({
    ignores: [
      ".nuxt/**",
      ".output/**",
      ".vitehub/**",
      "app/.vitehub/**",
      "dist/**",
      ".wrangler/**",
      ".data/**",
      "patches/**",
      "public/vendor/**",
      "skills/**/generated/**",
      "skills/**/*.md",
    ],
    stylistic: { quotes: "double", semi: false },
    lessOpinionated: true,
    imports: false,
    perfectionist: false,
    jsonc: false,
    yaml: false,
    toml: false,
    pnpm: false,
    typescript: {
      tsconfigPath: "./.nuxt/tsconfig.json",
      filesTypeAware: ["app/**/*.{ts,vue}", "server/**/*.ts", "shared/**/*.ts", "nuxt.config.ts"],
      overridesTypeAware: {
        // Existing runtime code intentionally uses truthiness for optional request values.
        "ts/strict-boolean-expressions": "off",
        "ts/no-use-before-define": "off",
      },
    },
    vue: { stylistic: false },
    regexp: true,
    unicorn: true,
    test: false,
  }),
  {
    rules: {
      // Preserve the repository's compact existing style while still checking semantics.
      "style/max-statements-per-line": "off",
      "style/member-delimiter-style": "off",
      "style/indent": "off",
      "style/brace-style": "off",
      "style/arrow-parens": "off",
      "style/quote-props": "off",
      "style/multiline-ternary": "off",
      "style/comma-dangle": "off",
      "style/no-multiple-empty-lines": "off",
      "style/no-mixed-operators": "off",
      "antfu/consistent-list-newline": "off",
      "antfu/consistent-chaining": "off",
      "ts/consistent-type-definitions": "off",
      "ts/method-signature-style": "off",
      "ts/promise-function-async": "off",
      "one-var": "off",
      "node/prefer-global/process": "off",
      "node/prefer-global/buffer": "off",
      "antfu/no-top-level-await": "off",
      "no-template-curly-in-string": "off",
      "curly": "off",
      "no-unexpected-multiline": "off",
      "unicorn/new-for-builtins": "off",
      "unicorn/number-literal-case": "off",
      "prefer-template": "off",
      "vue/html-indent": "off",
      "vue/prefer-separate-static-class": "off",
      "vue/singleline-html-element-content-newline": "off",
      "vue/block-tag-newline": "off",
      "vue/multiline-html-element-content-newline": "off",
      "vue/padding-line-between-blocks": "off",
    },
  },
  {
    files: ["test/**/*.mjs"],
    languageOptions: {
      globals: {
        after: "readonly",
        afterEach: "readonly",
        before: "readonly",
        beforeEach: "readonly",
        describe: "readonly",
        it: "readonly",
        test: "readonly",
      },
    },
    rules: {
      // Node's built-in test runner exposes these globals without an import.
      "no-undef": "off",
      "node/prefer-global/buffer": "off",
      "node/prefer-global/process": "off",
      "no-new-func": "off",
      "no-console": "off",
    },
  },
  {
    files: ["app/**/*.{ts,vue}"],
    rules: {
      // Vue/Nuxt macro inference is not available to the ESLint project service; vue-tsc remains authoritative.
      "ts/no-unsafe-assignment": "off",
      "ts/no-unsafe-argument": "off",
      "ts/no-unsafe-call": "off",
      "ts/no-unsafe-member-access": "off",
      "ts/no-unsafe-return": "off",
      "ts/no-misused-promises": "off",
      "ts/unbound-method": "off",
    },
  },
  {
    files: ["app/pages/d/**/*.vue"],
    rules: {
      // Nuxt's page wrapper intentionally nests the fallback template in this route.
      "vue/no-multiple-template-root": "off",
    },
  },
  {
    files: ["server/middleware/0.drop-access.ts", "server/utils/html-markdown.ts", "shared/plan-runtime.ts", "shared/project-bundle.ts", "shared/links.ts", "server/utils/drops.ts"],
    rules: {
      // These regexes parse user-authored markup and Unicode text; regexp heuristics misclassify their delimiters.
      "regexp/no-contradiction-with-assertion": "off",
      "regexp/no-super-linear-backtracking": "off",
      "regexp/no-unused-capturing-group": "off",
      "regexp/optimal-quantifier-concatenation": "off",
      "regexp/no-obscure-range": "off",
      "regexp/no-misleading-unicode-character": "off",
    },
  },
  {
    files: ["server/utils/code-image.ts", "shared/project-bundle.ts"],
    rules: { "style/no-mixed-operators": "off" },
  },
  {
    files: ["server/utils/identity.ts"],
    rules: {
      // jose exposes its verification error code through an untyped catch value.
      "ts/no-unsafe-member-access": "off",
    },
  },
  {
    files: ["server/utils/publish.ts"],
    rules: {
      // Valibot's schema and inferred output intentionally share this public name.
      "ts/no-redeclare": "off",
    },
  },
)
