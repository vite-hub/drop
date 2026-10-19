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
    ],
    stylistic: { quotes: "double", semi: false },
    typescript: { tsconfigPath: "./.nuxt/tsconfig.json" },
    vue: true,
    regexp: true,
    unicorn: true,
  }),
)
