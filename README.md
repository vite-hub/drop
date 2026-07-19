<p align="center">
  <a href="https://drop.vitehub.dev" target="_blank">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./public/logo-dark.svg">
      <source media="(prefers-color-scheme: light)" srcset="./public/logo-light.svg">
      <img alt="ViteHub Drop" src="./public/logo-light.svg" width="350" height="70" style="max-width: 100%;">
    </picture>
  </a>
</p>

<p align="center">Permanent image hosting for agents, built to showcase ViteHub primitives.</p>

<p align="center">
  <a href="https://drop.vitehub.dev">Website</a> ·
  <a href="https://vitehub.dev">ViteHub</a> ·
  <a href="https://vitehub.dev/docs/">ViteHub docs</a> ·
  <a href="https://github.com/vite-hub/vitehub">ViteHub on GitHub</a>
</p>

## How it works

1. **Blob** stores the original immediately at its permanent Drop key.
2. **Queue** dispatches an asynchronous optimization job and **KV** exposes its status.
3. **Sandbox** applies EXIF orientation, strips metadata, and resizes the image to fit within 2048 × 2048 without upscaling.
4. Drop replaces the Blob only when the optimized file is smaller, records byte savings in KV, and returns its permanent `/i/<id>` URL.

The Queue is deliberately more machinery than a small image host needs: Drop exists to exercise ViteHub's Blob, Queue, Sandbox, KV, Env, and Rate Limit primitives together with minimal application code.

## Use Drop

Install the public agent skill:

```sh
npx skills add https://drop.vitehub.dev
```

The bundled command uploads, polls the job, and prints the permanent URL:

```sh
node "<skill-directory>/scripts/upload-image.mjs" "/absolute/path/to/image.png"
```

Or use the API directly:

```sh
curl --fail-with-body https://drop.vitehub.dev/api/images \
  -F "image=@/absolute/path/to/image.png"
```

The upload response contains `statusUrl`. Poll it until `status` is `complete`; that response contains `url`. PNG, JPEG, and WebP images up to 4 MiB are accepted. Uploads are limited to five attempts per source address per minute.

## Run locally

You need Node.js 24 or newer, pnpm, Docker, and an authenticated Wrangler session. The full development command builds ViteHub's generated Worker configuration and starts Cloudflare's local runtime:

```sh
pnpm install
pnpm exec wrangler login
pnpm dev
```

ViteHub supplies the normal Sandbox container configuration. Drop has a root [`Dockerfile`](./Dockerfile) only because its sandbox needs the additional ImageMagick system package. Use `pnpm dev:landing` when you only need the static landing page and do not need the server primitives.

## Host it yourself

Drop runs on Cloudflare Workers with R2, Queues, KV, Rate Limiting, and Sandbox/Containers. Cloudflare Sandbox requires a Workers Paid plan.

1. Clone and install:

   ```sh
   git clone https://github.com/vite-hub/drop.git
   cd drop
   pnpm install
   pnpm exec wrangler login
   ```

2. Choose a unique package `name` in `package.json`, set `domain` in `vite.config.ts`, and set `DROP_ORIGIN` there to the same public origin.

3. Create the R2 bucket, KV namespace, and Queue named by the generated `.output/server/wrangler.json`. For this repository's default names:

   ```sh
   pnpm exec wrangler r2 bucket create vitehub-drop-images
   pnpm exec wrangler kv namespace create vitehub-drop-stats
   pnpm exec wrangler queues create queue--696d6167652d6f7074696d697a6174696f6e
   ```

   Put the returned KV namespace ID in the `DROP_STATS` entry in `vite.config.ts`. R2, Queue, Rate Limit, Sandbox, Container, Durable Object, and migration bindings are composed by ViteHub; the app only declares the KV ID because it is an existing Cloudflare resource.

4. Deploy and run the complete deployed-flow test:

   ```sh
   pnpm run deploy
   DROP_ORIGIN=https://YOUR_DOMAIN pnpm test:e2e:deployed
   ```

The deployed test drives the real skill command, Queue consumer, Sandbox, R2 object, KV job and statistics records, public image route, and upload rate limiter. It verifies orientation handling, metadata removal, bounded resizing, no upscaling, and that a larger optimization candidate never replaces the original.
