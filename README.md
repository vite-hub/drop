<p align="center">
  <a href="https://drop.vitehub.dev" target="_blank">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./public/logo-dark.svg">
      <source media="(prefers-color-scheme: light)" srcset="./public/logo-light.svg">
      <img alt="Drop" src="./public/logo-light.svg" width="220" height="84" style="max-width: 100%;">
    </picture>
  </a>
</p>

<p align="center">Permanent URLs for agent-uploaded files and temporary rendered code images, built with ViteHub primitives.</p>

<p align="center">
  <a href="https://drop.vitehub.dev">Website</a> ·
  <a href="https://vitehub.dev">ViteHub</a> ·
  <a href="https://vitehub.dev/docs/">ViteHub docs</a> ·
  <a href="https://github.com/vite-hub/vitehub">ViteHub on GitHub</a>
</p>

## How it works

1. **Blob** stores uploaded files permanently and keeps rendered code images under a separate temporary prefix.
2. PNG, JPEG, and WebP uploads continue through image optimization; other files are complete as soon as they are stored.
3. **Queue** dispatches image optimization to a Cloudflare **Sandbox** while the original upload URL is already usable.
4. Sharp applies EXIF orientation, strips metadata, and resizes images to fit within 2048 × 2048 without upscaling.
5. **Schedule** runs hourly and deletes expired code images from their prefix without touching uploaded files.
6. Drop replaces an uploaded Blob only when the optimized image is smaller. Nitro renders the current stored-file count into the landing page.

The Sandbox is a real npm project in [server/sandboxes/image-optimizer](./server/sandboxes/image-optimizer). ViteHub materializes that project through Workspace and executes it through the selected Box provider.

## Use Drop

Install the public agent skill:

```sh
npx skills add https://drop.vitehub.dev
```

The bundled command uploads and immediately prints the file URL:

```sh
node "<skill-directory>/scripts/upload-image.mjs" "/absolute/path/to/file.pdf"
```

Or use the API directly:

```sh
curl --fail-with-body https://drop.vitehub.dev/api/files \
  -F "file=@/absolute/path/to/file.pdf"
```

Files up to 4 MiB are accepted. PNG, JPEG, and WebP files are optimized when that makes them smaller; PDFs, spreadsheets, documents, archives, and other files are stored unchanged. The public deployment limits uploads to five attempts per source address per minute.

### Create a code image

The code API opens Ray.so through a ViteHub Browser Definition, applies the requested language, theme, and export scale, then uses Ray's native PNG or SVG export. Treat the URL as available for five minutes; an hourly ViteHub Schedule removes expired code images without touching permanent uploads.

```sh
curl --fail-with-body https://drop.vitehub.dev/api/code \
  -H "content-type: application/json" \
  --data '{"code":"const answer: number = 42","language":"TypeScript","theme":"Midnight","format":"png","scale":4}'
```

The response contains the temporary Drop URL and its expiry:

```json
{
  "url": "https://drop.vitehub.dev/i/code-images/1785240300000/4aa...png",
  "expiresAt": "2026-07-28T12:05:00.000Z"
}
```

`code` is required and accepts up to 20,000 characters. `format` accepts `png` or `svg`, while `scale` accepts `2`, `4`, or `6` and affects PNG exports. Both default to Ray's primary export settings: PNG at 4×. `language` and `theme` are optional, case-sensitive option names documented in the [Drop skill reference](./skills/vitehub-drop/references/code-options.md). When the image needs a permanent URL, download it before `expiresAt` and upload it through `/api/files`.

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

The test uploads `public/og-vitehub-drop.png` to the production URL and confirms the returned image is publicly accessible.

The hand mark is [Twemoji](https://github.com/twitter/twemoji) via [Iconify](https://iconify.design/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
