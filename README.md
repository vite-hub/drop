<p align="center">
  <a href="https://drop.vitehub.dev" target="_blank">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./public/logo-dark.svg">
      <source media="(prefers-color-scheme: light)" srcset="./public/logo-light.svg">
      <img alt="Drop" src="./public/logo-light.svg" width="220" height="84" style="max-width: 100%;">
    </picture>
  </a>
</p>

<p align="center">Immutable files and readable agent plans, built with ViteHub primitives.</p>

<p align="center">
  <a href="https://drop.vitehub.dev">Website</a> ·
  <a href="https://vitehub.dev">ViteHub</a> ·
  <a href="https://vitehub.dev/docs/">ViteHub docs</a> ·
  <a href="https://github.com/vite-hub/vitehub">ViteHub on GitHub</a>
</p>

## How it works

1. PNG, JPEG, and WebP uploads pass through a Cloudflare **Sandbox**, where Sharp applies EXIF orientation, strips metadata, and resizes them to fit within 2048 × 2048 without upscaling.
2. **Blob** writes each uploaded file once at a random `/i/` URL. If image optimization fails or does not make the file smaller, Drop stores the original.
3. Markdown files render as server-generated HTML at that URL through **Comark**. Their exact source remains available with `?raw`.
4. **Schedule** runs hourly and deletes expired code images from their separate prefix without touching uploaded files.
5. Nitro renders the current stored-file count into the landing page.

The Sandbox is a real npm project in [server/sandboxes/image-optimizer](./server/sandboxes/image-optimizer). ViteHub materializes that project through Workspace and executes it through the selected Box provider.

## Use Drop

Install the public agent skill:

```sh
npx skills add https://drop.vitehub.dev
```

Upload a file and print its URL:

```sh
curl --fail-with-body --silent --show-error \
  -F "file=@/absolute/path/to/file.pdf" \
  https://drop.vitehub.dev/api/files | jq -er '.url'
```

Or use the API directly:

```sh
curl --fail-with-body https://drop.vitehub.dev/api/files \
  -F "file=@/absolute/path/to/file.pdf"
```

Files up to 4 MiB are accepted. Every successful upload creates a new immutable URL. PNG, JPEG, and WebP files are optimized before storage when that makes them smaller; PDFs, spreadsheets, documents, archives, and other files are stored unchanged. Markdown renders as HTML at its URL and as source with `?raw`. The public deployment limits uploads to five attempts per source address per minute.

### Create a code image

The code API opens Ray.so through a ViteHub Browser Definition, applies the requested language, theme, and export scale, then clicks Ray's native PNG or SVG export. Treat the URL as available for five minutes; an hourly ViteHub Schedule removes expired code images without touching permanent uploads.

```sh
curl --fail-with-body https://drop.vitehub.dev/api/code \
  -H "content-type: application/json" \
  --data '{"code":"const answer: number = 42","language":"typescript","theme":"midnight","format":"png","scale":4}'
```

The response contains the temporary Drop URL and its expiry:

```json
{
  "url": "https://drop.vitehub.dev/i/code-images/1785240300000/4aa...png",
  "expiresAt": "2026-07-28T12:05:00.000Z"
}
```

`code` is required and accepts up to 20,000 characters. `format` accepts `png` or `svg`, while `scale` accepts `2`, `4`, or `6` and affects PNG exports. Both default to Ray's primary export settings: PNG at 4×. `language` and `theme` are optional, case-sensitive IDs discovered through the [Drop skill](./skills/vitehub-drop/SKILL.md#options). When the image needs a permanent URL, download it before `expiresAt` and upload it through `/api/files`.

## Host it yourself

Drop targets Cloudflare automatically with the deployment name `vitehub-drop`:

```sh
pnpm install
pnpm build
```

Cloudflare Sandbox requires a Workers Paid plan. Create the R2 bucket named by `.output/server/wrangler.json`, then deploy that generated configuration:

```sh
pnpm exec wrangler r2 bucket create vitehub-drop
pnpm exec wrangler deploy --config .output/server/wrangler.json
```

ViteHub composes the R2, Rate Limit, Sandbox, Container, Durable Object, and migration bindings, then emits the hourly Cron Trigger from the Schedule Definition.

Run the deployed smoke test:

```sh
pnpm test:e2e:deployed
```

The test uploads an image and a Markdown plan, confirms the image is publicly accessible, checks the rendered document and raw source, and exercises code-image rendering.

The hand mark is [Twemoji](https://github.com/twitter/twemoji) via [Iconify](https://iconify.design/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
