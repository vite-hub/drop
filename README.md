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
2. **Queue** dispatches asynchronous optimization while the permanent URL is already usable.
3. **Sandbox** applies EXIF orientation, strips metadata, and resizes the image to fit within 2048 × 2048 without upscaling.
4. Drop replaces the Blob only when the optimized file is smaller. The landing page counts the stored images directly.

Drop exercises ViteHub's Blob, Queue, Sandbox, and Rate Limit primitives with a small application surface.

## Use Drop

Install the public agent skill:

```sh
npx skills add https://drop.vitehub.dev
```

The bundled command uploads and immediately prints the permanent URL:

```sh
node "<skill-directory>/scripts/upload-image.mjs" "/absolute/path/to/image.png"
```

Or use the API directly:

```sh
curl --fail-with-body https://drop.vitehub.dev/api/images \
  -F "image=@/absolute/path/to/image.png"
```

The upload response contains `url`, which serves the original immediately and the optimized image after background processing. PNG, JPEG, and WebP images up to 4 MiB are accepted. Uploads are limited to five attempts per source address per minute.

## Run locally

You need Node.js 24 or newer, pnpm, Docker, and an authenticated Wrangler session. The full development command builds ViteHub's generated Worker configuration, watches source changes, and starts Cloudflare's local runtime:

```sh
pnpm install
pnpm exec wrangler login
pnpm dev
```

ViteHub supplies the Sandbox base image and generates the provider Dockerfile. Drop declares its additional ImageMagick build instruction beside the [`image-optimizer` sandbox](./server/sandboxes/image-optimizer.ts), so the workload and its system dependency stay together without a root Dockerfile. Use `pnpm dev:landing` when you only need the static landing page and do not need the server primitives.

## Host it yourself

Set `VITEHUB_HOSTING` to choose a generated deployment profile and
`DROP_DEPLOYMENT_NAME` to namespace provider resources:

| `VITEHUB_HOSTING` | Blob storage | Optimization | Rate limit |
| --- | --- | --- | --- |
| `cloudflare` | R2 | Queue and Sandbox | Cloudflare binding |
| `netlify` | Netlify Blobs | Inline | Process memory |
| `vercel` | Vercel Blob | Inline | Process memory |
| `node-server` | Local filesystem | Inline | Process memory |
| `deno-deploy` | Ephemeral filesystem | Inline | Process memory |

Cloudflare is the only profile that builds the ImageMagick Sandbox container, so
it is the only hosted build that needs Docker on the deployment machine. The
Node profile needs a persistent volume for permanent URLs. Deno Deploy currently
has no durable ViteHub Blob adapter, so its filesystem profile is suitable for
compatibility testing but does not satisfy Drop's permanent-storage promise.

Cloudflare Sandbox requires a Workers Paid plan.

1. Clone and install:

   ```sh
   git clone https://github.com/vite-hub/drop.git
   cd drop
   pnpm install
   pnpm exec wrangler login
   ```

2. Choose a unique deployment name and build the provider output:

   ```sh
   VITEHUB_HOSTING=cloudflare DROP_DEPLOYMENT_NAME=my-drop pnpm build
   ```

3. Create the R2 bucket and Queue named by the generated
   `.output/server/wrangler.json`, then deploy that configuration:

   ```sh
   pnpm exec wrangler r2 bucket create my-drop-images
   pnpm exec wrangler queues create QUEUE_NAME_FROM_WRANGLER_JSON
   pnpm exec wrangler deploy --config .output/server/wrangler.json
   ```

   R2, Queue, Rate Limit, Sandbox, Container, Durable Object, and migration bindings are composed by ViteHub.

4. Deploy and run the complete deployed-flow test:

   ```sh
   DROP_ORIGIN=https://YOUR_DOMAIN pnpm test:e2e:deployed
   ```

The deployed test drives the real skill command, Queue consumer, Sandbox, R2 object, upload count, public image route, and rate limiter. It verifies the permanent URL, orientation handling, metadata removal, and bounded resizing.
