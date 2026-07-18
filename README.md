<p align="center">
  <a href="https://drop.vitehub.dev" target="_blank">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./public/logo-dark.svg">
      <source media="(prefers-color-scheme: light)" srcset="./public/logo-light.svg">
      <img alt="ViteHub Drop" src="./public/logo-light.svg" width="350" height="70" style="max-width: 100%;">
    </picture>
  </a>
</p>

<p align="center">So your agent can post images on GitHub.</p>

<p align="center">
  <a href="https://drop.vitehub.dev">Website</a> ·
  <a href="https://vitehub.dev">ViteHub</a> ·
  <a href="https://vitehub.dev/docs/">ViteHub docs</a> ·
  <a href="https://github.com/vite-hub/vitehub">ViteHub on GitHub</a>
</p>

## How it works

1. An agent uploads one PNG, JPEG, or WebP image and gets a temporary public URL.
2. The agent posts that URL to GitHub, which renders the image through Camo.
3. The agent reads GitHub's rendered URL and replaces the Drop URL in the Markdown.

[ViteHub Queue](https://vitehub.dev/docs/server-primitives/queue/) schedules Drop's copy for deletion after up to 24 hours. GitHub's Camo URL is a proxy, not a permanent attachment, and may fetch the original URL again.

## Use Drop

Install the public agent skill:

```sh
npx skills add https://drop.vitehub.dev
```

Or upload directly with the API:

```sh
curl --fail-with-body https://drop.vitehub.dev/api/images \
  -F "image=@/absolute/path/to/image.png"
```

PNG, JPEG, and WebP images up to 4 MiB are accepted. The response includes the public URL and scheduled expiry time.

## Host it yourself

Drop is configured for Cloudflare Workers, R2, Queues, and Rate Limiting. You need Node.js 24 or newer, pnpm, a Cloudflare account, and a domain managed by Cloudflare.

1. Clone the repository and install its dependencies:

   ```sh
   git clone https://github.com/vite-hub/drop.git
   cd drop
   pnpm install
   ```

2. Choose a unique package `name` in `package.json`; the Worker, R2 bucket, and rate-limit namespace derive from it.

3. Change `domain` in `vite.config.ts` and replace `drop.vitehub.dev` in `public/index.html`. The bundled script can target your deployment through `DROP_ORIGIN`.

   Drop needs no application secrets. `NITRO_DROP_ORIGIN` is the production environment variable that controls the image URLs returned by the API.

4. Log in to Cloudflare and create the derived R2 bucket and expiry queue.

   ```sh
   pnpm exec wrangler login
   pnpm exec wrangler r2 bucket create YOUR_BUCKET_NAME
   pnpm exec wrangler queues create queue--696d6167652d657870697279
   ```

5. Build and deploy. The build generates the final Wrangler configuration and bindings from `vite.config.ts`.

   ```sh
   pnpm build
   pnpm deploy
   ```

6. Verify the deployment with an image from your machine. The response should contain a URL on your domain.

   ```sh
   curl --fail-with-body https://YOUR_DOMAIN/api/images \
     -F "image=@/absolute/path/to/image.png"
   ```

## Run locally

```sh
pnpm install
pnpm dev
```
