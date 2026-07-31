---
name: vitehub-drop
description: Uploads a local file and returns its permanent public URL. Use when an agent needs to include a local image or document in GitHub content like issues, Pull Request, etc... It can also render source code as a temporary image URL.
---

# ViteHub Drop

Choose one branch and return its stdout verbatim.

## File

Upload a file placed in scope:

```sh
curl --fail-with-body --silent --show-error \
  -F "file=@/absolute/path/to/file.pdf" \
  https://drop.vitehub.dev/api/files |
  jq -er '.url'
```

## Code

Render code in Ray.so wrapper.
```sh
curl --fail-with-body --silent --show-error \
  -H "content-type: application/json" \
  --data '{"code":"const answer: number = 42","language":"TypeScript","theme":"Midnight","format":"png","scale":4}' \
  https://drop.vitehub.dev/api/code |
  jq -er '.url'
```

Code image URLs expire after five minutes; download and re-upload through File to make one permanent.

## Options
- `languages`*: Any of:  `Cedar`, `Bash`, `Astro`, `C++`, `C#`, `Clojure`, `Console`, `Crystal`, `CSS`, `Cypher`, `Dart`, `Diff`, `Docker`, `Elm`, `ERB`, `Elixir`, `Erlang`, `Gleam`, `GraphQL`, `Go`, `HCL`, `Haskell`, `HTML`, `Java`, `JavaScript`, `Julia`, `JSON`, `JSX`, `Kotlin`, `LaTeX`, `Liquid`, `Lisp`, `Lua`, `Markdown`, `MATLAB`, `Move`, `Nix`, `Plaintext`, `Powershell`, `Objective-C`, `OCaml`, `PHP`, `Prisma`, `Python`, `R`, `Ruby`, `Rust`, `Scala`, `SCSS`, `Solidity`, `SQL`, `Swift`, `Svelte`, `TOML`, `TypeScript`, `TSX`, `V`, `Vue`, `XML`, `YAML`, `Zig`.
- `theme`*: `Vercel`, `Supabase`, `Tailwind`, `OpenAI`, `Mintlify`, `Prisma`, `Clerk`, `ElevenLabs`, `Resend`, `Trigger.dev`, `Nuxt`, `Browserbase`, `Cloudflare`, `Gemini`, `Stripe`, `Bitmap`, `Noir`, `Ice`, `Sand`, `Forest`, `Mono`, `Breeze`, `Candy`, `Crimson`, `Falcon`, `Meadow`, `Midnight`, `Raindrop`, `Sunset`, `Firecrawl`, `AWS`, `Auth0`.
   `format` accepts `png` (default) or `svg`.
- `scale` for png accepts `2`, `4` (default), or `6`.
