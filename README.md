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

1. **Blob** stores the original immediately at its Drop key.
2. On Cloudflare and Vercel, **Queue** dispatches optimization to a **Sandbox** while the original URL is already usable.
3. Other presets optimize inline with the same provider-neutral application route.
4. Sharp applies EXIF orientation, strips metadata, and resizes the image to fit within 2048 × 2048 without upscaling.
5. Drop replaces the Blob only when the optimized file is smaller. The landing page counts stored images directly.

The Sandbox is a real npm project in [server/sandboxes/image-optimizer](./server/sandboxes/image-optimizer). ViteHub materializes that project through Workspace and executes it through the selected Box provider.

## Use Drop

Install the public agent skill:

```sh
npx skills add https://drop.vitehub.dev
```

The bundled command uploads and immediately prints the image URL:

```sh
node "<skill-directory>/scripts/upload-image.mjs" "/absolute/path/to/image.png"
```

Or use the API directly:

```sh
curl --fail-with-body https://drop.vitehub.dev/api/images \
  -F "image=@/absolute/path/to/image.png"
```

PNG, JPEG, and WebP images up to 4 MiB are accepted. The public deployment limits uploads to five attempts per source address per minute.

## Run locally

You need Node.js 24 or newer and pnpm. The Node preset is the smallest local path and does not require Docker:

```sh
pnpm install
VITEHUB_PRESET=node VITEHUB_DEPLOYMENT_NAME=drop-local pnpm build
node .output/server/index.mjs
```

Use `pnpm dev:landing` when you only need the static landing page. The full `pnpm dev` command targets Cloudflare, watches source changes, and starts Wrangler; exercising its Sandbox also requires Docker and an authenticated Wrangler session.

## Host it yourself

Set `VITEHUB_PRESET` to one of ViteHub's built-in presets and `VITEHUB_DEPLOYMENT_NAME` to namespace provider resources:

| `VITEHUB_PRESET` | Blob storage | Optimization | Rate limit |
| --- | --- | --- | --- |
| `cloudflare` | R2, durable | Queue and Sandbox | Cloudflare binding |
| `vercel` | Vercel Blob, durable | Queue and Sandbox | Disabled: no distributed driver |
| `netlify` | Netlify Blobs, durable | Inline | Disabled: no distributed driver |
| `node` | Filesystem, single host | Inline | Process-local memory |
| `deno` | Filesystem compatibility mode, non-durable | Inline | Disabled: no distributed driver |

Drop does not substitute process-local rate limiting on horizontally scaled hosts, and it does not claim Queue or Sandbox delivery where the preset cannot provide those guarantees. The generated `deployment.json` records the selected host, artifact, adapters, guarantees, and explicit unsupported reasons.

The Node artifact needs a persistent volume to retain URLs across process replacement. Deno Deploy has no durable ViteHub Blob adapter, so Drop explicitly selects filesystem compatibility mode; uploads can disappear when a revision or instance is replaced and that target does not satisfy Drop's permanent-storage promise.

Build any target with one preset selection:

```sh
VITEHUB_PRESET=netlify VITEHUB_DEPLOYMENT_NAME=my-drop pnpm build
```

For Deno Deploy, ViteHub stages Sharp's Linux x64 and ARM64 native packages and generates a non-interactive create-or-update runner:

```sh
VITEHUB_PRESET=deno VITEHUB_DEPLOYMENT_NAME=my-drop pnpm build
DENO_DEPLOY_ORG=my-org node .output/deploy.mjs
```

Set `DENO_DEPLOY_APP` when the app name should differ from `VITEHUB_DEPLOYMENT_NAME`.

Cloudflare Sandbox requires a Workers Paid plan. After building the `cloudflare` preset, create the R2 bucket and Queue named by `.output/server/wrangler.json`, then deploy that generated configuration:

```sh
pnpm exec wrangler r2 bucket create my-drop-images
pnpm exec wrangler queues create QUEUE_NAME_FROM_WRANGLER_JSON
pnpm exec wrangler deploy --config .output/server/wrangler.json
```

ViteHub composes the R2, Queue, Rate Limit, Sandbox, Container, Durable Object, and migration bindings.

Run the complete flow against any deployed origin, declaring whether that preset provides rate limiting:

```sh
DROP_ORIGIN=https://YOUR_DOMAIN \
DROP_EXPECT_RATE_LIMIT=1 \
pnpm test:e2e:deployed
```

Set `DROP_EXPECT_RATE_LIMIT=0` for Netlify, Vercel, and Deno. The test drives the public skill command, waits for the optimized image, checks orientation and metadata removal, confirms Blob listing, and verifies the declared rate-limit policy. ViteHub's generated `deployment.json` records whether the build uses isolated or inline optimization.
