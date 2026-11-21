import { createHighlighterCore, type HighlighterCore } from "shiki/core"
import { createJavaScriptRegexEngine } from "shiki/engine/javascript"

const LANGUAGES = {
  bash: () => import("@shikijs/langs/bash"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  csharp: () => import("@shikijs/langs/csharp"),
  css: () => import("@shikijs/langs/css"),
  diff: () => import("@shikijs/langs/diff"),
  go: () => import("@shikijs/langs/go"),
  graphql: () => import("@shikijs/langs/graphql"),
  html: () => import("@shikijs/langs/html"),
  java: () => import("@shikijs/langs/java"),
  javascript: () => import("@shikijs/langs/javascript"),
  json: () => import("@shikijs/langs/json"),
  jsx: () => import("@shikijs/langs/jsx"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  markdown: () => import("@shikijs/langs/markdown"),
  php: () => import("@shikijs/langs/php"),
  python: () => import("@shikijs/langs/python"),
  ruby: () => import("@shikijs/langs/ruby"),
  rust: () => import("@shikijs/langs/rust"),
  sql: () => import("@shikijs/langs/sql"),
  swift: () => import("@shikijs/langs/swift"),
  toml: () => import("@shikijs/langs/toml"),
  tsx: () => import("@shikijs/langs/tsx"),
  typescript: () => import("@shikijs/langs/typescript"),
  vue: () => import("@shikijs/langs/vue"),
  yaml: () => import("@shikijs/langs/yaml"),
} as const

export const CODE_LANGUAGE_LABELS: Record<keyof typeof LANGUAGES, string> = {
  bash: "Bash",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  diff: "Diff",
  go: "Go",
  graphql: "GraphQL",
  html: "HTML",
  java: "Java",
  javascript: "JavaScript",
  json: "JSON",
  jsx: "JSX",
  kotlin: "Kotlin",
  markdown: "Markdown",
  php: "PHP",
  python: "Python",
  ruby: "Ruby",
  rust: "Rust",
  sql: "SQL",
  swift: "Swift",
  toml: "TOML",
  tsx: "TSX",
  typescript: "TypeScript",
  vue: "Vue",
  yaml: "YAML",
}

const LANGUAGE_ALIASES = new Map<string, keyof typeof LANGUAGES>([
  ["js", "javascript"],
  ["mjs", "javascript"],
  ["cjs", "javascript"],
  ["ts", "typescript"],
  ["mts", "typescript"],
  ["sh", "bash"],
  ["shell", "bash"],
  ["zsh", "bash"],
  ["py", "python"],
  ["rb", "ruby"],
  ["rs", "rust"],
  ["md", "markdown"],
  ["yml", "yaml"],
  ["c++", "cpp"],
  ["cs", "csharp"],
  ["kt", "kotlin"],
])

const THEMES = {
  "github-dark": () => import("@shikijs/themes/github-dark"),
  "github-light": () => import("@shikijs/themes/github-light"),
  "vitesse-dark": () => import("@shikijs/themes/vitesse-dark"),
  "vitesse-light": () => import("@shikijs/themes/vitesse-light"),
  "one-dark-pro": () => import("@shikijs/themes/one-dark-pro"),
  "night-owl": () => import("@shikijs/themes/night-owl"),
  "tokyo-night": () => import("@shikijs/themes/tokyo-night"),
  dracula: () => import("@shikijs/themes/dracula"),
  nord: () => import("@shikijs/themes/nord"),
  "catppuccin-mocha": () => import("@shikijs/themes/catppuccin-mocha"),
} as const

export type CodeTheme = keyof typeof THEMES

const isKeyOf = <T extends object>(table: T, name: string): name is Extract<keyof T, string> =>
  Object.hasOwn(table, name)

export const isCodeTheme = (name: string): name is CodeTheme => isKeyOf(THEMES, name)

export type CodeLanguage = keyof typeof LANGUAGES

export function codeLanguage(name: string | null | undefined): CodeLanguage | undefined {
  const requested = name?.trim().split(/\s/, 1)[0]?.toLowerCase()
  return requested ? (isKeyOf(LANGUAGES, requested) ? requested : LANGUAGE_ALIASES.get(requested)) : undefined
}

let highlighter: Promise<HighlighterCore> | undefined

export async function loadHighlighter(language: string | undefined, themes: CodeTheme[]) {
  highlighter ??= createHighlighterCore({ themes: [], langs: [], engine: createJavaScriptRegexEngine() })
  const shiki = await highlighter
  const lang = codeLanguage(language)
  if (lang && !shiki.getLoadedLanguages().includes(lang)) await shiki.loadLanguage((await LANGUAGES[lang]()).default)
  for (const theme of themes)
    if (!shiki.getLoadedThemes().includes(theme)) await shiki.loadTheme((await THEMES[theme]()).default)
  return { shiki, lang: lang ?? "text" }
}
