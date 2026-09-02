<p align="center">
  <a href="https://drop.vitehub.dev" target="_blank">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./public/logo-dark.svg">
      <source media="(prefers-color-scheme: light)" srcset="./public/logo-light.svg">
      <img alt="Drop" src="./public/logo-light.svg" width="220" height="84" style="max-width: 100%;">
    </picture>
  </a>
</p>

<p align="center">Permanent files, readable Markdown, and code images, built with ViteHub primitives.</p>

<p align="center">
  <a href="https://drop.vitehub.dev">Website</a> ·
  <a href="https://vitehub.dev">ViteHub</a> ·
  <a href="https://vitehub.dev/docs/">ViteHub docs</a> ·
  <a href="https://github.com/vite-hub/drop">Source</a>
</p>

## How it works

1. **Blob** stores the original upload immediately at a random `/i/` URL.
2. For PNG, JPEG, and WebP files, **Queue** asks a Cloudflare **Sandbox** to apply EXIF orientation, strip metadata, and resize the image to fit within 2048 × 2048 without upscaling.
3. Drop replaces the original image at the same URL only when the optimized version is smaller. Other files never change.
4. Markdown files render as server-generated HTML at that URL through **Comark**. Their exact source remains available with `?raw`.
5. **Schedule** runs hourly and deletes expired code images from their separate prefix without touching uploaded files.
6. Nitro renders the current stored-file count into the landing page.

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

Files up to 4 MiB are accepted. Every successful upload creates a permanent, non-editable URL. PNG, JPEG, and WebP files are available immediately and may be replaced at the same URL by a smaller optimized version; PDFs, spreadsheets, documents, archives, and other files never change. Markdown renders as HTML at its URL and as source with `?raw`. The public deployment limits uploads to five attempts per source address per minute.

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

Cloudflare Sandbox requires a Workers Paid plan. Create the R2 bucket and Queue named by `.output/server/wrangler.json`, then deploy that generated configuration:

```sh
pnpm exec wrangler r2 bucket create vitehub-drop
pnpm exec wrangler queues create QUEUE_NAME_FROM_WRANGLER_JSON
pnpm exec wrangler deploy --config .output/server/wrangler.json
```

ViteHub composes the R2, Queue, Rate Limit, Sandbox, Container, Durable Object, and migration bindings, then emits the hourly Cron Trigger from the Schedule Definition.

Run the deployed smoke test:

```sh
pnpm test:e2e:deployed
```

The test uploads an image and a Markdown plan, confirms the image is publicly accessible, checks the rendered document and raw source, and exercises code-image rendering.

The hand mark is [Twemoji](https://github.com/twitter/twemoji) via [Iconify](https://iconify.design/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
